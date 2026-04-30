const fs = require('fs');
let code = fs.readFileSync('c:/Users/User/react-bits-clone/src/content/Backgrounds/LiquidEther/LiquidEther.jsx', 'utf8');
let startIdx = code.indexOf('function makePaletteTexture');
let endIdx = code.indexOf('const container = mountRef.current;');
let webglCode = code.substring(startIdx, endIdx);

// Remove the `isVisibleRef.current` logic that exists inside WebGLManager since we are going Vanilla.
// Also fix React refs to standard variables.
webglCode = webglCode.replace('if (isVisibleRef.current) {', 'if (true) {');
webglCode = webglCode.replace('rafRef.current = requestAnimationFrame(this._loop);', 'this.rafId = requestAnimationFrame(this._loop);');
webglCode = webglCode.replace(/rafRef\.current/g, 'this.rafId');

let outCode = `window.LiquidEther = function(container, options = {}) {
  let colors = options.colors || ['#5227FF', '#FF9FFC', '#B19EEF'];
  let autoDemo = options.autoDemo !== undefined ? options.autoDemo : true;
  let autoSpeed = options.autoSpeed || 0.5;
  let autoIntensity = options.autoIntensity || 2.2;
  let takeoverDuration = options.takeoverDuration || 0.25;
  let autoResumeDelay = options.autoResumeDelay || 1000;
  let autoRampDuration = options.autoRampDuration || 0.6;
  let mouseForce = options.mouseForce || 20;
  let cursorSize = options.cursorSize || 100;
  let isViscous = options.isViscous || false;
  let viscous = options.viscous || 30;
  let iterationsViscous = options.iterationsViscous || 0; // optimized default
  let iterationsPoisson = options.iterationsPoisson || 10; // optimized default
  let dt = options.dt || 0.014;
  let BFECC = options.BFECC !== undefined ? options.BFECC : false; // optimized default
  let resolution = options.resolution || 0.3; // optimized default for mobile

` + webglCode + `

  container.style.position = container.style.position || 'relative';
  container.style.overflow = container.style.overflow || 'hidden';
  
  const webgl = new WebGLManager({
    $wrapper: container,
    autoDemo, autoSpeed, autoIntensity, takeoverDuration, autoResumeDelay, autoRampDuration
  });
  
  const sim = webgl.output && webgl.output.simulation;
  if (sim) {
    Object.assign(sim.options, {
      mouse_force: mouseForce, cursor_size: cursorSize, isViscous, viscous, iterations_viscous: iterationsViscous, iterations_poisson: iterationsPoisson, dt, BFECC, resolution, isBounce
    });
    sim.resize();
  }
  webgl.start();
  return webgl;
};`;
fs.writeFileSync('public/js/liquid-ether.js', outCode);
