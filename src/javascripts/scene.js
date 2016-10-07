import TweenMax from 'gsap';
import {STATE, MODE, INITIAL_CONFIG, EVENT} from './constants';
import Physics from './physics';
import Hud from './hud';
import SoundManager from './sound-manager';
import $ from 'jquery';
import WebVRManager from './webvr-manager';

import Table from './models/table';
import Paddle from './models/paddle';
import Net from './models/net';
import Ball from './models/ball';
import BiggerBalls from './powerup/bigger-balls';
import Time from './util/time';

const DEBUG_MODE = true;
const resetTimeoutDuration = 5000;

export default class Scene {
  constructor(emitter, communication) {
    this.emitter = emitter;
    this.time = new Time();

    this.communication = communication;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.controls = null;
    this.controller = null;
    this.effect = null;
    this.loader = null;
    this.table = null;
    this.display = null;
    this.manager = null;
    this.gamePad = null;
    this.controller1 = null;
    this.controller2 = null;
    this.raycaster = null;
    this.paddlePlane = null;
    this.controlMode = 'pan';
    this.controllerRay = null;
    this.net = null;
    this.tabActive = true;
    this.ball = null;
    this.physicsDebugRenderer = null;
    this.resetBallTimeout = null;
    this.state = STATE.PRELOADER;
    this.insaneInterval = null;
    this.insaneBallNumber = 0;

    this.playerRequestedRestart = false;
    this.opponentRequestedRestart = false;

    this.playerRequestedCountdown = false;
    this.opponentRequestedCountdown = false;

    this.viewport = {
      width: $(document).width(),
      height: $(document).height(),
    };

    this.score = {
      self: 0,
      opponent: 0,
    };

    this.config = Object.assign({}, INITIAL_CONFIG);
    this.physics = new Physics(this.config, this.ballPaddleCollision.bind(this));
    this.sound = new SoundManager();

    this.frameNumber = 0;
    this.totaltime = 0;
    this.lastRender = 0;
  }

  setup() {
    return new Promise((resolve, reject) => {
      this.setupThree();
      this.table = Table(this.scene, this.config);
      this.setupVR();
      this.net = Net(this.scene, this.config);

      this.renderer.domElement.requestPointerLock = this.renderer.domElement.requestPointerLock
        || this.renderer.domElement.mozRequestPointerLock;
      this.renderer.domElement.onclick = () => {
        this.renderer.domElement.requestPointerLock();
      };

      this.physics.setupWorld();

      if (DEBUG_MODE) {
        this.physicsDebugRenderer = new THREE.CannonDebugRenderer(this.scene, this.physics.world);
      }

      this.setupEventListeners();
      this.setupPaddles();
      this.setupPaddlePlane();
      this.setupLights();

      this.hud = new Hud(this.scene, this.config, this.emitter, this.hudInitialized.bind(this));

      resolve('loaded');
    });
  }

  setupEventListeners() {
    this.emitter.on(EVENT.GAME_OVER, e => {
      this.time.clearInterval(this.insaneInterval);
      this.config.state = STATE.GAME_OVER;
    });
  }

  setupVRControls() {
    // apply VR headset positional data to camera.
    this.controls = new THREE.VRControls(this.camera);
    this.controls.standing = true;
    this.controls.userHeight = this.config.cameraHeight;
    this.setupControllers();
  }

  setupVR() {
    // apply VR stereo rendering to renderer.
    this.effect = new THREE.VREffect(this.renderer);
    this.effect.setSize(window.innerWidth, window.innerHeight);

    // Create a VR manager helper to enter and exit VR mode.
    let params = {
      hideButton: false, // Default: false.
      isUndistorted: false // Default: false.
    };

    this.manager = new WebVRManager(this.renderer, this.effect, params);

    window.addEventListener('resize', this.onResize.bind(this), true);
    window.addEventListener('vrdisplaypresentchange', this.onResize.bind(this), true);
  }

  setupThree() {
    this.renderer = new THREE.WebGLRenderer({antialias: true});
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setClearColor(this.config.colors.BLUE_BACKGROUND, 1);
    document.body.appendChild(this.renderer.domElement);

    // THREE js basics
    this.scene = new THREE.Scene();
    this.scene.scale.y = 0.01;

    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 10000);
    // position over the box, will be animated to the final camera position
    this.camera.position.x = 0;
    this.camera.position.z = this.config.tablePositionZ;
    this.camera.position.y = 5;
    this.camera.up.set(-1, 0, 0);
    this.camera.lookAt(new THREE.Vector3(0, 1, this.config.tablePositionZ));

    // neccessary for the vive controllers
    this.loader = new THREE.TextureLoader();
  }

  setupLights() {
    let light = new THREE.DirectionalLight(0xffffff, 0.5);
    light.position.z = 3;
    light.position.y = 2;
    light.position.x = 1;
    this.scene.add(light);

    light = new THREE.AmbientLight(0xffffff, 0.7);
    this.scene.add(light);
  }

  setupPaddlePlane() {
    this.raycaster = new THREE.Raycaster();

    // set opacity to 0 because otherwise it wont be intersected by the raytracer
    // TODO use this instead https://threejs.org/docs/#Reference/Math/Plane
    let geometry = new THREE.PlaneGeometry(10, 10);
    let material = new THREE.MeshBasicMaterial({color: 0xffff00, side: THREE.DoubleSide, transparent: true, opacity: 0});
    this.paddlePlane = new THREE.Mesh(geometry, material);
    this.paddlePlane.position.z = this.config.paddlePositionZ;
    this.paddlePlane.position.y = this.config.tableHeight;
    this.scene.add(this.paddlePlane);
  }

  setupControllers() {
    navigator.getVRDisplays().then(displays => {
      if (displays) {
        // if we have more than 1 display: ¯\_(ツ)_/¯
        // TODO
        this.display = displays[0];
        if (displays[0].capabilities && displays[0].capabilities.hasPosition) {
          this.controlMode = 'move';
          // also check gamepads
          this.controller1 = new THREE.ViveController(0);
          this.controller1.standingMatrix = this.controls.getStandingMatrix();
          this.scene.add(this.controller1);
          this.controller2 = new THREE.ViveController(1);
          this.controller2.standingMatrix = this.controls.getStandingMatrix();
          this.scene.add(this.controller2);

          var loader = new THREE.OBJLoader();
          loader.setPath('/models/');
          loader.load('vr_controller_vive_1_5.obj', object => {
            var loader = new THREE.TextureLoader();
            loader.setPath('/models/');

            this.controller = object.children[ 0 ];
            this.controller.material.map = loader.load('onepointfive_texture.png');
            this.controller.material.specularMap = loader.load('onepointfive_spec.png');

            this.controller1.add(object.clone());
            this.controller2.add(object.clone());
          });
        }
      }
    });

    if (DEBUG_MODE) {
      var material = new THREE.LineBasicMaterial({
        color: 0x00ffff,
      });
      var geometry = new THREE.Geometry();
      geometry.vertices.push(
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, 0)
      );
      this.controllerRay = new THREE.Line(geometry, material);
      this.controllerRay.geometry.dynamic = true;
      this.scene.add(this.controllerRay);
    }
  }

  setupPaddles() {
    // player paddle
    this.paddle = Paddle(this.scene, this.config);
    // calculate bounding box for manual collision prediction
    this.paddleBoundingBox = new THREE.BoundingBoxHelper(this.paddle, 0xffffff);
    this.paddleBoundingBox.material.visible = false;
    this.scene.add(this.paddleBoundingBox);

    // opponent, set to invisible for now
    this.paddleOpponent = Paddle(this.scene, this.config, this.config.colors.WHITE);
    this.paddleOpponent.position.z = this.config.boxPositionZ - this.config.boxDepth / 2;
    this.paddleOpponent.position.y = 1;
    this.paddleOpponent.visible = false;
  }

  hudInitialized() {
    // TODO move this to the right place
    if (this.config.mode === MODE.MULTIPLAYER) {
      this.hud.scoreDisplay.opponentScore.visible = true;
      this.paddleOpponent.visible = true;
    }
    requestAnimationFrame(this.animate.bind(this));
  }

  startGame() {
    // null object for tweening
    let no = {
      fov: this.camera.fov,
      upX: -1,
      upY: 0,
      scaleY: 0.01,
    };

    this.paddle.visible = false;
    this.hud.container.visible = false;

    let tl = new TimelineMax();
    tl.to('.intro-wrapper', 0.4, {
      autoAlpha: 0,
    }, 0);

    const panDuration = 1;

    tl.to(no, panDuration, {
      fov: 75,
      upX: 0,
      upY: 1,
      scaleY: 1,
      ease: Power3.easeIn,
      onUpdate: () => {
        this.scene.scale.y = no.scaleY;
        this.camera.fov = no.fov;
        this.camera.up.set(no.upX, no.upY, 0);
        this.camera.updateProjectionMatrix();
      },
    }, 1);
    tl.to(this.camera.position, panDuration, {
      x: 0,
      y: this.config.cameraHeight,
      z: 0,
      onUpdate: () => {
        this.camera.lookAt(new THREE.Vector3(0, 1, this.config.tablePositionZ));
      },
      onComplete: () => {
        this.paddle.visible = true;
        this.hud.container.visible = true;

        this.setupVRControls();
        this.hud.message.showMessage();
      }
    }, 1);
    tl.call(() => {
      if (this.config.mode === MODE.SINGLEPLAYER) {
        this.countdown();
      } else {
        this.communication.sendRequestCountdown();
        this.playerRequestedCountdown = true;
        this.requestCountdown();
      }
    }, [], null, '+=1');
  }

  receivedRequestCountdown() {
    this.hud.scoreDisplay.opponentScore.visible = true;
    this.paddleOpponent.visible = true;
    this.opponentRequestedCountdown = true;
    this.requestCountdown();
  }

  requestCountdown() {
    if (this.playerRequestedCountdown && this.opponentRequestedCountdown) {
      this.countdown();
    }
  }

  countdown() {
    this.hud.message.hideMessage();
    this.config.state = STATE.COUNTDOWN;
    // countdown from 3, start game afterwards
    this.hud.countdown.showCountdown();
    let n = 2;
    let countdown = this.time.setInterval(() => {
      this.hud.countdown.setCountdown(n);
      n--;
      if (n < 0) {
        this.time.clearInterval(countdown);
        this.hud.countdown.hideCountdown();
        if (this.config.mode === MODE.SINGLEPLAYER) {
          this.addBall();
        } else if (this.config.mode === MODE.MULTIPLAYER
            && !this.communication.isHost) {
          let physicsBody = this.addBall();
          // if multiplayer, also send the other player a hit so the ball is synced
          this.communication.sendHit({
            x: this.physics.ball.position.x,
            y: this.physics.ball.position.y,
            z: this.physics.ball.position.z,
          }, {
            x: this.physics.ball.velocity.x,
            y: this.physics.ball.velocity.y,
            z: this.physics.ball.velocity.z,
          }, physicsBody._name, true);
        }
      }
    }, 1000);
  }

  restartGame() {
    // only restart if both players requested it
    if (this.opponentRequestedRestart && this.playerRequestedRestart) {
      this.emitter.emit(EVENT.RESTART_GAME, this.score);
      // TODO reset mode?

      // reset
      this.playerRequestedRestart = false;
      this.opponentRequestedRestart = false;
      this.resetScore();
      this.countdown();
    }
  }

  resetScore() {
    this.score.self = 0;
    this.score.opponent = 0;
    // propagate to HUD
    this.hud.scoreDisplay.setSelfScore(0);
    this.hud.scoreDisplay.setOpponentScore(0);
  }

  setMultiplayer() {
    // prepare multiplayer mode
    this.config.mode = MODE.MULTIPLAYER;
    this.physics.frontWall.collisionResponse = 0;
    // setup communication channels,
    // add callbacks for received actions
    // TODO throw exception on connection failure
    this.communication.setCallbacks({
      move: this.receivedMove.bind(this),
      hit: this.receivedHit.bind(this),
      miss: this.receivedMiss.bind(this),
      restartGame: this.receivedRestartGame.bind(this),
      requestCountdown: this.receivedRequestCountdown.bind(this),
    });
  }

  setSingleplayer() {
    this.config.mode = MODE.SINGLEPLAYER;
  }

  receivedMove(move) {
    // received a move from the opponent,
    // set his paddle to the position received
    let no = {
      x: this.paddleOpponent.position.x,
      y: this.paddleOpponent.position.y,
    };
    TweenMax.to(no, 0.14, {
      x: move.x,
      y: move.y,
      onUpdate: () => {
        this.paddleOpponent.position.x = no.x;
        this.paddleOpponent.position.y = no.y;
      }
    });
  }

  receivedRestartGame() {
    this.opponentRequestedRestart = true;
    // try to restart game, only does if player also requested restart
    this.restartGame();
  }

  receivedHit(data) {
    // we might not have a ball yet
    if (data.addBall) {
      // this doesnt add a ball if it already exists so were safe to call it
      // (except in insane mode, then we keep adding balls
      this.addBall();
    }
    // received vectors are in the other users space
    // invert x and z velocity and mirror the point across the center of the box
    this.physics.ball.position.copy(this.mirrorBallPosition(data.point));
    this.physics.ball.velocity.copy(this.mirrorBallVelocity(data.velocity));
  }

  mirrorBallPosition(pos) {
    let z = pos.z;
    z = z - Math.sign(z - this.config.tablePositionZ) * Math.abs(z - this.config.tablePositionZ) * 2;
    return {
      x: -pos.x, 
      y: pos.y,
      z: z,
    };
  }

  mirrorBallVelocity(vel) {
    return {
      x: -vel.x,
      y: vel.y,
      z: -vel.z,
    };
  }

  receivedMiss(data) {
    // opponent missed, update player score
    // and set game to be over if the score is high enough
    let ball = this.scene.getObjectByName(data.name);
    this.score.self++;
    this.hud.scoreDisplay.setSelfScore(this.score.self);
    if (this.score.self >= this.config.POINTS_FOR_WIN) {
      this.emitter.emit(EVENT.GAME_OVER, this.score);
    } else {
      // otherwise, the opponent that missed also resets the ball
      // and sends along its new position
      this.receivedHit(data);
    }
  }

  resetPingpongTimeout() {
    // reset the ball position in case the ball is stuck at the net
    if (this.config.mode !== MODE.MULTIPLAYER) {
      this.time.clearTimeout(this.resetBallTimeout);
      this.resetBallTimeout = this.time.setTimeout(() => {
        this.physics.initBallPosition();
      }, resetTimeoutDuration);
    }
  }

  ballIsInBox(ball) {
    // add tolerance to be sure ball wont be reset if the ball is
    // 'inside' of a wall for a short period
    const E = 0.1;
    return ball.position.z - E <= 4
        && ball.position.z + E >= -4;
  }

  ballPaddleCollision(point, physicsBody) {
    // the ball collided with the players paddle
    this.resetPingpongTimeout();
    this.paddleCollisionAnimation();
    this.sound.hit(point);
    if (this.config.mode === MODE.SINGLEPLAYER) {
      this.score.self++;
      this.hud.scoreDisplay.setSelfScore(this.score.self);
      return;
    }
    // mode is multiplayer, send the hit with a small timeout
    // to make sure the collision is done and the ball is not
    // somewhere in the opponents paddle with a weird velocity
    // TODO tweak and test this timeout
    setTimeout(() => {
      this.communication.sendHit({
        x: point.x,
        y: point.y,
        z: point.z,
      }, {
        x: physicsBody.velocity.x,
        y: physicsBody.velocity.y,
        z: physicsBody.velocity.z,
      }, physicsBody._name);
    }, 10);
  }

  paddleCollisionAnimation() {
    // blink the paddle interior
    if (!this.paddle.getObjectByName('paddleHitHighlight')) {
      return;
    }
    this.paddle.getObjectByName('paddleHitHighlight').material.opacity = 1;
    TweenMax.to(this.paddle.getObjectByName('paddleHitHighlight').material, 0.5, {
      opacity: 0,
      ease: Power2.easeOut,
    });
  }

  addBall() {
    if (this.ball) {
      return false;
    }
    let color;
    color = 0xFFFFFF;
    let ball = new Ball(this.scene, this.config, color);
    ball.name = ball.uuid;
    let physicsBall = this.physics.addBall(ball);
    this.ball = ball;
    this.ball.physicsReference = physicsBall;
    this.resetPingpongTimeout();
    this.config.state = STATE.PLAYING;
    return ball.physicsReference;
  }

  setPaddlePosition(x, y, z) {
    this.paddle.position.x = x;
    this.paddle.position.y = y;
    this.paddle.position.z = this.config.paddlePositionZ;
    this.physics.setPaddlePosition(x, y, this.config.paddlePositionZ);
  }

  updateControls() {
    // TODO proper controller managment
    let controller = null;
    if (this.controller1 && this.controller1.visible) {
      controller = this.controller1;
    } else if (this.controller2 && this.controller2.visible) {
      controller = this.controller2;
    }

    // place paddle according to controller
    if (this.display) {
      let pose = this.display.getPose();
      if (pose) {
        if (!controller) {
          // if we dont have a controller, intersect the paddlePlane
          // with where the camera is looking and place the paddle there
          this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
          this.raycaster.far = 2;
          let intersects = this.raycaster.intersectObject(this.paddlePlane, false);
          if (intersects.length > 0) {
            let intersectionPoint = intersects[0].point;
            let posX =  intersectionPoint.x * 4;
            let posY = this.config.cameraHeight + (this.config.cameraHeight - intersectionPoint.y) * -4;
            this.setPaddlePosition(posX, posY, this.config.paddlePositionZ + 0.03);
          }
        } else if (this.controlMode === 'move' && controller) {
          // if we do have a controller, intersect it with where the controller is looking
          let direction = new THREE.Vector3(0, 0, -1);
          direction.applyQuaternion(controller.getWorldQuaternion());
          direction.normalize();
          this.raycaster.set(controller.getWorldPosition(), direction);
          this.raycaster.far = 10;
          let intersects = this.raycaster.intersectObject(this.paddlePlane, false);
          if (intersects.length > 0) {
            let intersectionPoint = intersects[0].point;
            this.setPaddlePosition(intersectionPoint.x, intersectionPoint.y, this.config.paddlePositionZ + 0.03);
          }
        }
      }
    }
  }

  updateBall(ball) {
    ball.position.copy(ball.physicsReference.position);
    ball.quaternion.copy(ball.physicsReference.quaternion);
    if (!this.ballIsInBox(ball)) {
      // player has missed the ball, reset position to center
      if (this.config.mode === MODE.MULTIPLAYER) {
        // TODO change this to a timeout
        if (ball.position.z > 4 || ball.position.z < -4) {
          // opponent scored, send a miss
          this.score.opponent++;
          this.hud.scoreDisplay.setOpponentScore(this.score.opponent);
          if (this.score.opponent < this.config.POINTS_FOR_WIN) {
            console.log(1);
            // the game goes on
            this.physics.initBallPosition();
          } else {
            // game is over
            // TODO maybe wait a little with this so players can enjoy their 11 points
            this.emitter.emit(EVENT.GAME_OVER, this.score);
          }
          // tell the opponent
          this.communication.sendMiss({
            x: ball.physicsReference.position.x,
            y: ball.physicsReference.position.y,
            z: ball.physicsReference.position.z,
          }, {
            x: ball.physicsReference.velocity.x,
            y: ball.physicsReference.velocity.y,
            z: ball.physicsReference.velocity.z,
          });
        }
      } else {
        console.log(2);
        this.resetPingpongTimeout();
        // TODO pingpong scoring
        this.physics.initBallPosition();
        this.score.self = 0;
        this.hud.scoreDisplay.setSelfScore(this.score.self);
      }
    }
  }

  animate(timestamp) {
    let delta = Math.min(timestamp - this.lastRender, 500);
    this.totaltime += delta;

    // TODO proper managment for inactive tabs
    if (!this.tabActive) {
      requestAnimationFrame(this.animate.bind(this));
      return;
    }

    this.updateControls();

    // for multiplayer testing, set one player to always hit the ball,
    // easier to test for latency related issues that way
    if (this.ball && this.config.mode === MODE.MULTIPLAYER && !this.communication.isHost) {
      //this.setPaddlePosition(this.ball.position.x, this.ball.position.y);
    }

    // raycaster position and direction is now either camera
    // or controller on vive
    this.hud.cameraRayUpdated(this.raycaster);

    if (this.config.state === STATE.PLAYING) {
      if (this.config.mode === MODE.MULTIPLAYER) {
        // send where the paddle has moved, if it has moved
        this.communication.sendMove(-this.paddle.position.x, this.paddle.position.y);
      }

      this.paddleBoundingBox.update();

      this.physics.step(delta / 1000);

      this.updateBall(this.ball);
      this.physics.predictCollisions(this.ball.physicsReference, this.paddleBoundingBox, this.scene.getObjectByName('net-collider'));
    }

    if (DEBUG_MODE) {
      this.physicsDebugRenderer.update();
    }

    // Update VR headset position and apply to camera.
    if (this.controls) {
      this.controls.update();
    }

    this.time.step();

    // Render the scene through the manager.
    this.lastRender = timestamp;

    this.manager.render(this.scene, this.camera, this.timestamp);

    this.frameNumber++;
    requestAnimationFrame(this.animate.bind(this));
  }

  onResize(e) {
    this.effect.setSize(window.innerWidth, window.innerHeight);
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }
}
