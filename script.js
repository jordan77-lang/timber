// --- THREE.JS SETUP ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

let renderContainer = document.getElementById('container');
if (!renderContainer) {
  renderContainer = document.createElement('div');
  renderContainer.id = 'container';
  renderContainer.style.width = '1000px';
  renderContainer.style.height = '800px';
  renderContainer.style.margin = '30px auto';
  document.body.insertBefore(renderContainer, document.querySelector('.spectro-section'));
}

const camera = new THREE.PerspectiveCamera(75, 1000/800, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(1000, 800);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
renderer.xr.enabled = true;
renderContainer.appendChild(renderer.domElement);

// WebXR setup
let xrSession = null;
let xrRefSpace = null;
const controllers = [];
const controllerGrips = [];

// Create custom VR button
function createVRButton(isSupported) {
  const button = document.createElement('button');
  button.style.cssText = 'position: relative; padding: 12px 24px; border: 1px solid white; background: rgba(0,0,0,0.8); color: white; font-size: 13px; text-align: center; opacity: 0.9; outline: none; z-index: 999; cursor: pointer; font-family: sans-serif; margin: 10px;';
  
  if (!isSupported) {
    button.textContent = 'OPEN ON VR DEVICE TO ENTER VR';
    button.style.cursor = 'default';
    button.style.opacity = '0.6';
    button.onclick = function() {
      alert('WebXR not available. Please open this page on a VR device like Meta Quest.');
    };
  } else {
    button.textContent = 'ENTER VR';
    button.onclick = function() {
      if (renderer.xr.isPresenting) {
        renderer.xr.getSession().end();
      } else {
        navigator.xr.requestSession('immersive-vr', {
          requiredFeatures: ['local-floor'],
          optionalFeatures: ['hand-tracking', 'bounded-reference-space']
        }).then((session) => {
          renderer.xr.setSession(session);
          button.textContent = 'EXIT VR';
          session.addEventListener('end', () => {
            button.textContent = 'ENTER VR';
          });
        }).catch((err) => {
          console.error('Failed to start VR session:', err);
          alert('Failed to start VR: ' + err.message);
        });
      }
    };
  }
  
  return button;
}

// Always add VR button, regardless of support
if (navigator.xr) {
  navigator.xr.isSessionSupported('immersive-vr').then((supported) => {
    console.log('VR supported:', supported);
    
    let vrButton;
    // Try to use THREE.VRButton if available and supported, otherwise use custom
    if (supported && typeof THREE !== 'undefined' && THREE.VRButton) {
      try {
        vrButton = THREE.VRButton.createButton(renderer);
      } catch(e) {
        console.log('THREE.VRButton failed, using custom button');
        vrButton = createVRButton(supported);
      }
    } else {
      vrButton = createVRButton(supported);
    }
    
    const vrContainer = document.getElementById('vr-button-container');
    console.log('VR container found:', vrContainer);
    if (vrContainer) {
      vrContainer.appendChild(vrButton);
      console.log('VR button added');
    } else {
      document.body.insertBefore(vrButton, document.body.firstChild);
    }
  }).catch((err) => {
    console.error('Error checking VR support:', err);
    // Even if check fails, add a button
    const vrButton = createVRButton(false);
    const vrContainer = document.getElementById('vr-button-container');
    if (vrContainer) {
      vrContainer.appendChild(vrButton);
    } else {
      document.body.insertBefore(vrButton, document.body.firstChild);
    }
  });
} else {
  console.log('navigator.xr not available');
  // No WebXR API, show informational button
  const vrButton = createVRButton(false);
  const vrContainer = document.getElementById('vr-button-container');
  if (vrContainer) {
    vrContainer.appendChild(vrButton);
  } else {
    document.body.insertBefore(vrButton, document.body.firstChild);
  }
}

// Controller setup
function setupController(index) {
  const controller = renderer.xr.getController(index);
  controller.addEventListener('selectstart', onVRSelectStart);
  controller.addEventListener('selectend', onVRSelectEnd);
  controller.addEventListener('select', onVRSelect);
  scene.add(controller);
  controllers[index] = controller;

  const controllerGrip = renderer.xr.getControllerGrip(index);
  scene.add(controllerGrip);
  controllerGrips[index] = controllerGrip;

  // Add ray line for controller
  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, -1)
  ]);
  const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0xffff00 }));
  line.name = 'line';
  line.scale.z = 5;
  controller.add(line);

  return controller;
}

setupController(0);
setupController(1);

// VR interaction state
let vrDraggedDot = null;
let vrDraggedController = null;
let vrDraggedHand = null;
let vrDraggedHandle = null;
let vrDraggedHandRotating = null;
const hands = [];
const handModels = [];

// Hand tracking setup
function setupHand(index) {
  const hand = renderer.xr.getHand(index);
  hand.addEventListener('pinchstart', onHandPinchStart);
  hand.addEventListener('pinchend', onHandPinchEnd);
  scene.add(hand);
  hands[index] = hand;
  
  // Add spheres for hand joints visualization
  const handModel = {
    joints: {},
    spheres: {}
  };
  
  const sphereGeometry = new THREE.SphereGeometry(0.008, 8, 8);
  const sphereMaterial = new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.7 });
  
  hand.addEventListener('connected', (event) => {
    const xrInputSource = event.data;
    if (xrInputSource.hand) {
      const joints = ['wrist', 'thumb-tip', 'index-finger-tip', 'middle-finger-tip', 'ring-finger-tip', 'pinky-finger-tip'];
      joints.forEach(jointName => {
        const sphere = new THREE.Mesh(sphereGeometry.clone(), sphereMaterial.clone());
        sphere.visible = false;
        hand.add(sphere);
        handModel.spheres[jointName] = sphere;
      });
    }
  });
  
  handModels[index] = handModel;
  return hand;
}

setupHand(0);
setupHand(1);

// --- BUILD TIMBRE CUBE ---
const cubeGroup = new THREE.Group();
cubeGroup.rotation.y = Math.PI / 12; // Rotate counter-clockwise about 15 degrees
scene.add(cubeGroup);

const cubeSize = 4;
const faces = [];
let hoverLines = null;
let vrHoverLinesLeft = null;
let vrHoverLinesRight = null;
let loadedModel = null;
let invisibleCube = null;
let spectralFluxLabel = null;

// Create an invisible cube that fills the entire volume for raycasting
// Make it much larger to ensure we catch all areas
const invisibleGeometry = new THREE.BoxGeometry(cubeSize * 1.5, cubeSize * 1.5, cubeSize * 1.5);
const invisibleMaterial = new THREE.MeshBasicMaterial({ 
  transparent: true, 
  opacity: 0,
  side: THREE.DoubleSide // Detect from both inside and outside
});
invisibleCube = new THREE.Mesh(invisibleGeometry, invisibleMaterial);
invisibleCube.userData.isInvisibleBoundingBox = true;
cubeGroup.add(invisibleCube);

// Load the GLB model
const loader = new THREE.GLTFLoader();
loader.load('cube_transparent_artistic_reference.glb', function(gltf) {
  loadedModel = gltf.scene;
  
  // Scale and position the model
  const box = new THREE.Box3().setFromObject(loadedModel);
  const size = box.getSize(new THREE.Vector3());
  const scale = cubeSize / Math.max(size.x, size.y, size.z);
  loadedModel.scale.setScalar(scale);
  
  // Center the model
  const center = box.getCenter(new THREE.Vector3());
  loadedModel.position.sub(center.multiplyScalar(scale));
  
  // Make top and front faces more transparent for better visibility
  loadedModel.traverse(function(child) {
    if (child.isMesh) {
      // Hide all faces by default
      child.visible = false;
    }
  });
  
  cubeGroup.add(loadedModel);
  
  // Create the three visible walls
  createFace(new THREE.Vector3(-cubeSize/2, 0, 0), new THREE.Vector3(0, -Math.PI/2, 0), 0x00ff88, 'Brightness × Attack', new THREE.Vector3(-1, 0, 0));
  createFace(new THREE.Vector3(0, -cubeSize/2, 0), new THREE.Vector3(-Math.PI/2, 0, 0), 0xff6b9d, 'Spectral Flux × Attack', new THREE.Vector3(0, -1, 0));
  createFace(new THREE.Vector3(0, 0, -cubeSize/2), new THREE.Vector3(0, Math.PI, 0), 0xc44569, 'Spectral Flux × Brightness', new THREE.Vector3(0, 0, -1));
}, undefined, function(error) {
  console.error('Error loading GLB model:', error);
  // Fallback to creating plane faces if model fails to load
  createFallbackCube();
});

function createFallbackCube() {
  createFace(new THREE.Vector3(-cubeSize/2, 0, 0), new THREE.Vector3(0, -Math.PI/2, 0), 0x00ff88, 'Brightness × Attack', new THREE.Vector3(-1, 0, 0));
  createFace(new THREE.Vector3(0, -cubeSize/2, 0), new THREE.Vector3(-Math.PI/2, 0, 0), 0xff6b9d, 'Spectral Flux × Attack', new THREE.Vector3(0, -1, 0));
  createFace(new THREE.Vector3(0, 0, -cubeSize/2), new THREE.Vector3(0, Math.PI, 0), 0xc44569, 'Spectral Flux × Brightness', new THREE.Vector3(0, 0, -1));
}

function createFace(position, rotation, color, label, normalVector) {
  const geometry = new THREE.PlaneGeometry(cubeSize, cubeSize, 10, 10);
  const material = new THREE.MeshPhysicalMaterial({
    color: color,
    metalness: 0.05,
    roughness: 0.2,
    transparent: true,
    opacity: 0.4,
    transmission: 0.75,
    ior: 1.5,
    reflectivity: 0.5,
    clearcoat: 0.3,
    clearcoatRoughness: 0.2,
    side: THREE.DoubleSide
  });
  const face = new THREE.Mesh(geometry, material);
  face.position.copy(position);
  face.rotation.setFromVector3(rotation);
  face.userData = { label, normalVector, color };
  face.castShadow = true;
  face.receiveShadow = true;
  cubeGroup.add(face);
  faces.push(face);
  
  // Add glowing edge lines to the face
  const edgeGeometry = new THREE.EdgesGeometry(geometry);
  const edgeMaterial = new THREE.LineBasicMaterial({ 
    color: color,
    linewidth: 2
  });
  const edges = new THREE.LineSegments(edgeGeometry, edgeMaterial);
  edges.position.copy(position);
  edges.rotation.setFromVector3(rotation);
  cubeGroup.add(edges);
  
  return face;
}

// Create rotation handles - line with ball at the end on all four sides
const handleBallGeometry = new THREE.SphereGeometry(0.12, 32, 32);
const handleBallMaterial = new THREE.MeshPhysicalMaterial({
  color: 0xffaa00,
  metalness: 0.7,
  roughness: 0.2,
  emissive: 0x665500
});

// Front handle
const handleLineFront = new THREE.BufferGeometry();
handleLineFront.setFromPoints([
  new THREE.Vector3(0, -cubeSize/2, cubeSize/2),
  new THREE.Vector3(0, -cubeSize/2, cubeSize/2 + 0.6)
]);
const handleLineMatFront = new THREE.LineBasicMaterial({ color: 0xffaa00, linewidth: 3 });
const handleLineMeshFront = new THREE.Line(handleLineFront, handleLineMatFront);
handleLineMeshFront.userData.isHandle = true;
cubeGroup.add(handleLineMeshFront);

const handleBallFront = new THREE.Mesh(handleBallGeometry, handleBallMaterial);
handleBallFront.position.set(0, -cubeSize/2, cubeSize/2 + 0.6);
handleBallFront.castShadow = true;
handleBallFront.receiveShadow = true;
handleBallFront.userData.isHandle = true;
cubeGroup.add(handleBallFront);

// Back handle
const handleLineBack = new THREE.BufferGeometry();
handleLineBack.setFromPoints([
  new THREE.Vector3(0, -cubeSize/2, -cubeSize/2),
  new THREE.Vector3(0, -cubeSize/2, -cubeSize/2 - 0.6)
]);
const handleLineMatBack = new THREE.LineBasicMaterial({ color: 0xffaa00, linewidth: 3 });
const handleLineMeshBack = new THREE.Line(handleLineBack, handleLineMatBack);
handleLineMeshBack.userData.isHandle = true;
cubeGroup.add(handleLineMeshBack);

const handleBallBack = new THREE.Mesh(handleBallGeometry.clone(), handleBallMaterial);
handleBallBack.position.set(0, -cubeSize/2, -cubeSize/2 - 0.6);
handleBallBack.castShadow = true;
handleBallBack.receiveShadow = true;
handleBallBack.userData.isHandle = true;
cubeGroup.add(handleBallBack);

// Left handle
const handleLineLeft = new THREE.BufferGeometry();
handleLineLeft.setFromPoints([
  new THREE.Vector3(-cubeSize/2, -cubeSize/2, 0),
  new THREE.Vector3(-cubeSize/2 - 0.6, -cubeSize/2, 0)
]);
const handleLineMatLeft = new THREE.LineBasicMaterial({ color: 0xffaa00, linewidth: 3 });
const handleLineMeshLeft = new THREE.Line(handleLineLeft, handleLineMatLeft);
handleLineMeshLeft.userData.isHandle = true;
cubeGroup.add(handleLineMeshLeft);

const handleBallLeft = new THREE.Mesh(handleBallGeometry.clone(), handleBallMaterial);
handleBallLeft.position.set(-cubeSize/2 - 0.6, -cubeSize/2, 0);
handleBallLeft.castShadow = true;
handleBallLeft.receiveShadow = true;
handleBallLeft.userData.isHandle = true;
cubeGroup.add(handleBallLeft);

// Right handle
const handleLineRight = new THREE.BufferGeometry();
handleLineRight.setFromPoints([
  new THREE.Vector3(cubeSize/2, -cubeSize/2, 0),
  new THREE.Vector3(cubeSize/2 + 0.6, -cubeSize/2, 0)
]);
const handleLineMatRight = new THREE.LineBasicMaterial({ color: 0xffaa00, linewidth: 3 });
const handleLineMeshRight = new THREE.Line(handleLineRight, handleLineMatRight);
handleLineMeshRight.userData.isHandle = true;
cubeGroup.add(handleLineMeshRight);

const handleBallRight = new THREE.Mesh(handleBallGeometry.clone(), handleBallMaterial);
handleBallRight.position.set(cubeSize/2 + 0.6, -cubeSize/2, 0);
handleBallRight.castShadow = true;
handleBallRight.receiveShadow = true;
handleBallRight.userData.isHandle = true;
cubeGroup.add(handleBallRight);

// Create array of all handle balls for raycasting
const handleBalls = [handleBallFront, handleBallBack, handleBallLeft, handleBallRight];

// Don't create faces immediately - wait for model to load or use fallback
// createFace calls are now in createFallbackCube() function

// Enhanced lighting for realistic appearance
const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
scene.add(ambientLight);

// Key light (main directional light with shadows)
const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
keyLight.position.set(5, 8, 5);
keyLight.castShadow = true;
keyLight.shadow.mapSize.width = 2048;
keyLight.shadow.mapSize.height = 2048;
keyLight.shadow.camera.near = 0.5;
keyLight.shadow.camera.far = 50;
scene.add(keyLight);

// Fill light (softer, from opposite side)
const fillLight = new THREE.DirectionalLight(0x4488ff, 0.5);
fillLight.position.set(-5, 3, -5);
scene.add(fillLight);

// Rim light (from behind for edge definition)
const rimLight = new THREE.DirectionalLight(0xff8844, 0.3);
rimLight.position.set(0, 2, -8);
scene.add(rimLight);

// Add subtle fog for depth
scene.fog = new THREE.Fog(0x000000, 5, 15);

camera.position.set(3.5, 3.2, 3.5);
camera.lookAt(0, 0, 0);

// Position cube for VR - move it in front of user when in VR mode
renderer.xr.addEventListener('sessionstart', () => {
  cubeGroup.position.set(0, 1.2, -2.5);
  cubeGroup.scale.setScalar(0.6);
});

renderer.xr.addEventListener('sessionend', () => {
  cubeGroup.position.set(0, 0, 0);
  cubeGroup.scale.setScalar(1);
  camera.position.set(3.5, 3.2, 3.5);
  camera.lookAt(0, 0, 0);
});

// --- AXIS LABELS ---
function createAxisLabels() {
  // Function to create a glowing text canvas
  function createLabelCanvas(text, arrow = '') {
    const labelCanvas = document.createElement('canvas');
    labelCanvas.width = 512;
    labelCanvas.height = 128;
    const labelCtx = labelCanvas.getContext('2d');
    
    // Clear with transparent background
    labelCtx.clearRect(0, 0, labelCanvas.width, labelCanvas.height);
    
    // Draw glowing text
    labelCtx.font = 'bold 48px Arial';
    labelCtx.fillStyle = '#00ff88';
    labelCtx.textAlign = 'left';
    labelCtx.textBaseline = 'middle';
    
    // Glow effect
    labelCtx.shadowColor = '#00ff88';
    labelCtx.shadowBlur = 20;
    labelCtx.shadowOffsetX = 0;
    labelCtx.shadowOffsetY = 0;
    
    labelCtx.fillText(text + ' ' + arrow, 20, 64);
    
    return labelCanvas;
  }
  
  // Function to create vertical label canvas
  function createVerticalLabelCanvas(text) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d');
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw text vertically (one letter per line)
    ctx.font = 'bold 80px Arial';
    ctx.fillStyle = '#00ff88';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    ctx.shadowColor = '#00ff88';
    ctx.shadowBlur = 30;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    
    // Calculate spacing for vertical text
    const letters = text.split('');
    const totalHeight = letters.length * 90;
    const startY = (canvas.height - totalHeight) / 2 + 45;
    
    letters.forEach((letter, i) => {
      ctx.fillText(letter, canvas.width / 2, startY + i * 90);
    });
    
    return canvas;
  }
  
  // Function to create large label canvas for plane labels
  function createLargeLabelCanvas(text) {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    ctx.font = 'bold 80px Arial';
    ctx.fillStyle = '#00ff88';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    ctx.shadowColor = '#00ff88';
    ctx.shadowBlur = 30;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);
    
    return canvas;
  }
  
  // Bottom edge - Spectral Flux label removed
  
  // Left edge - Brightness label removed
  
  // Left plane - Brightness label with two versions (front and back view)
  // Front view label: "Brightness↓"
  const brightnessLabelFront = createVerticalLabelCanvas('Brightness↓');
  const brightnessTextureFront = new THREE.CanvasTexture(brightnessLabelFront);
  brightnessTextureFront.needsUpdate = true;
  const brightnessMaterialFront = new THREE.MeshBasicMaterial({
    map: brightnessTextureFront,
    transparent: true,
    alphaTest: 0.1,
    depthWrite: false,
    depthTest: false,
    side: THREE.FrontSide
  });
  const brightnessGeomFront = new THREE.PlaneGeometry(0.7, 3.2);
  const brightnessMeshFront = new THREE.Mesh(brightnessGeomFront, brightnessMaterialFront);
  brightnessMeshFront.position.set(-cubeSize/2 + 0.1, 0, cubeSize/2 - 0.15);
  brightnessMeshFront.rotation.y = Math.PI / 2;
  brightnessMeshFront.renderOrder = 999;
  cubeGroup.add(brightnessMeshFront);
  
  // Back view label: "Brightness↓" (arrow pointing down from back view)
  const brightnessLabelBack = createVerticalLabelCanvas('Brightness↓');
  const brightnessTextureBack = new THREE.CanvasTexture(brightnessLabelBack);
  brightnessTextureBack.needsUpdate = true;
  const brightnessMaterialBack = new THREE.MeshBasicMaterial({
    map: brightnessTextureBack,
    transparent: true,
    alphaTest: 0.1,
    depthWrite: false,
    depthTest: false,
    side: THREE.FrontSide
  });
  const brightnessGeomBack = new THREE.PlaneGeometry(0.7, 3.2);
  const brightnessMeshBack = new THREE.Mesh(brightnessGeomBack, brightnessMaterialBack);
  brightnessMeshBack.position.set(-cubeSize/2 + 0.1, 0, cubeSize/2 - 0.15);
  brightnessMeshBack.rotation.y = -Math.PI / 2; // Face opposite direction
  brightnessMeshBack.renderOrder = 999;
  cubeGroup.add(brightnessMeshBack);
  
  // Bottom plane - Transients Density label with two versions (top and bottom view)
  // Top view label: "Transients Density →"
  const transientsLabelTop = createLargeLabelCanvas('Transients Density →');
  const transientsTextureTop = new THREE.CanvasTexture(transientsLabelTop);
  transientsTextureTop.needsUpdate = true;
  const transientsMaterialTop = new THREE.MeshBasicMaterial({ 
    map: transientsTextureTop, 
    transparent: true,
    alphaTest: 0.1,
    depthWrite: false,
    depthTest: false,
    side: THREE.FrontSide
  });
  const transientsGeomTop = new THREE.PlaneGeometry(3.2, 0.7);
  const transientsMeshTop = new THREE.Mesh(transientsGeomTop, transientsMaterialTop);
  transientsMeshTop.position.set(cubeSize/2 - 0.3, -cubeSize/2 + 0.1, 0);
  transientsMeshTop.rotation.x = -Math.PI / 2;
  transientsMeshTop.rotation.z = Math.PI / 2;
  transientsMeshTop.renderOrder = 999;
  cubeGroup.add(transientsMeshTop);
  
  // Bottom view label: "← Transients Density" (arrow before text for bottom view)
  const transientsLabelBottom = createLargeLabelCanvas('← Transients Density');
  const transientsTextureBottom = new THREE.CanvasTexture(transientsLabelBottom);
  transientsTextureBottom.needsUpdate = true;
  const transientsMaterialBottom = new THREE.MeshBasicMaterial({ 
    map: transientsTextureBottom, 
    transparent: true,
    alphaTest: 0.1,
    depthWrite: false,
    depthTest: false,
    side: THREE.FrontSide
  });
  const transientsGeomBottom = new THREE.PlaneGeometry(3.2, 0.7);
  const transientsMeshBottom = new THREE.Mesh(transientsGeomBottom, transientsMaterialBottom);
  transientsMeshBottom.position.set(cubeSize/2 - 0.3, -cubeSize/2 + 0.1, 0);
  transientsMeshBottom.rotation.x = Math.PI / 2; // Flip to face downward
  transientsMeshBottom.rotation.z = Math.PI / 2;
  transientsMeshBottom.renderOrder = 999;
  cubeGroup.add(transientsMeshBottom);
  
  // Axis labels removed to clean up view
}

createAxisLabels();

// --- FACE LABELS (on inside surfaces) ---
function createFaceLabels() {
  function createLargeLabelCanvas(text) {
    const labelCanvas = document.createElement('canvas');
    labelCanvas.width = 4096;
    labelCanvas.height = 1024;
    const labelCtx = labelCanvas.getContext('2d');
    
    labelCtx.clearRect(0, 0, labelCanvas.width, labelCanvas.height);
    labelCtx.font = 'bold 400px Arial';
    labelCtx.fillStyle = '#00ff88';
    labelCtx.textAlign = 'center';
    labelCtx.textBaseline = 'middle';
    
    labelCtx.shadowColor = '#00ff88';
    labelCtx.shadowBlur = 60;
    labelCtx.shadowOffsetX = 0;
    labelCtx.shadowOffsetY = 0;
    
    labelCtx.fillText(text, 2048, 512);
    
    return labelCanvas;
  }
  
  function createVerticalLabelCanvas(text) {
    const labelCanvas = document.createElement('canvas');
    labelCanvas.width = 1024;
    labelCanvas.height = 4096;
    const labelCtx = labelCanvas.getContext('2d');
    
    labelCtx.clearRect(0, 0, labelCanvas.width, labelCanvas.height);
    labelCtx.font = 'bold 400px Arial';
    labelCtx.fillStyle = '#00ff88';
    labelCtx.textAlign = 'center';
    labelCtx.textBaseline = 'middle';
    
    labelCtx.shadowColor = '#00ff88';
    labelCtx.shadowBlur = 60;
    labelCtx.shadowOffsetX = 0;
    labelCtx.shadowOffsetY = 0;
    
    labelCtx.fillText(text, 512, 2048);
    
    return labelCanvas;
  }
  
  // Bottom/Front face - removed label
  
  // Left/Brightness face - Label removed (now using vertical axis labels)
  
  // Back/Transients face - "Spectral Flux" with two labels (front and back)
  // Front-facing label: "Spectral Flux →"
  const backLabelFront = createLargeLabelCanvas('Spectral Flux →');
  const backTextureFront = new THREE.CanvasTexture(backLabelFront);
  backTextureFront.needsUpdate = true;
  const backMaterialFront = new THREE.MeshBasicMaterial({ 
    map: backTextureFront, 
    transparent: true,
    alphaTest: 0.1,
    depthWrite: false,
    depthTest: false,
    side: THREE.FrontSide
  });
  const backGeomFront = new THREE.PlaneGeometry(3.2, 0.7);
  const backMeshFront = new THREE.Mesh(backGeomFront, backMaterialFront);
  backMeshFront.position.set(0, cubeSize/2 - 0.3, -cubeSize/2 + 0.1);
  backMeshFront.renderOrder = 999;
  backMeshFront.userData.isSpectralFluxLabel = true;
  backMeshFront.userData.isFrontLabel = true;
  spectralFluxLabel = backMeshFront;
  cubeGroup.add(backMeshFront);
  
  // Back-facing label: "← Spectral Flux" (arrow before text pointing left from back view)
  const backLabelBack = createLargeLabelCanvas('← Spectral Flux');
  const backTextureBack = new THREE.CanvasTexture(backLabelBack);
  backTextureBack.needsUpdate = true;
  const backMaterialBack = new THREE.MeshBasicMaterial({ 
    map: backTextureBack, 
    transparent: true,
    alphaTest: 0.1,
    depthWrite: false,
    depthTest: false,
    side: THREE.FrontSide
  });
  const backGeomBack = new THREE.PlaneGeometry(3.2, 0.7);
  const backMeshBack = new THREE.Mesh(backGeomBack, backMaterialBack);
  backMeshBack.position.set(0, cubeSize/2 - 0.3, -cubeSize/2 + 0.1);
  backMeshBack.rotation.y = Math.PI; // Rotate 180 to face opposite direction
  backMeshBack.renderOrder = 999;
  backMeshBack.userData.isSpectralFluxLabel = true;
  backMeshBack.userData.isBackLabel = true;
  cubeGroup.add(backMeshBack);
}

createFaceLabels();

// --- TONE.JS SETUP ---
const mixBus = new Tone.Gain(1);
const analyser = Tone.context.createAnalyser();
analyser.fftSize = 512;
analyser.smoothingTimeConstant = 0.6;
mixBus.connect(analyser);
mixBus.connect(Tone.Destination);

const masterBus = new Tone.Gain(0.75);
masterBus.connect(mixBus);

const reverb = new Tone.Reverb({
  decay: 2.8,
  preDelay: 0.03,
  wet: 1
});
reverb.connect(mixBus);

// Track playing dots
const dots = [];
let dotIdCounter = 0;

function createDotVoice(dot) {
  const output = new Tone.Gain(0.8);
  output.connect(masterBus);

  const reverbSend = new Tone.Gain(0.18);
  output.connect(reverbSend);
  reverbSend.connect(reverb);

  const ampEnv = new Tone.AmplitudeEnvelope({
    attack: 0.12,
    decay: 0.25,
    sustain: 0.7,
    release: 1.4
  }).connect(output);

  const autoFilter = new Tone.AutoFilter({
    frequency: 0.3,
    baseFrequency: 250,
    octaves: 3,
    depth: 0.25,
    type: 'sine'
  }).connect(ampEnv);
  autoFilter.start();

  const fundamentalGain = new Tone.Gain(0.25).connect(autoFilter);
  const lowGain = new Tone.Gain(0.25).connect(autoFilter);
  const highGain = new Tone.Gain(0.25).connect(autoFilter);

  const fundamental = new Tone.Oscillator({
    type: 'sine',
    frequency: 220
  }).connect(fundamentalGain);

  const lowPartial = new Tone.Oscillator({
    type: 'custom',
    partials: [0, 1, 0.65, 0.35, 0.2],
    frequency: 220
  }).connect(lowGain);

  const highPartial = new Tone.Oscillator({
    type: 'custom',
    partials: [0, 0, 0, 0.8, 0.6, 0.4, 0.25, 0.18],
    frequency: 220
  }).connect(highGain);

  const noise = new Tone.Noise('pink');
  const noiseFilter = new Tone.Filter({
    type: 'bandpass',
    frequency: 1200,
    Q: 1.2
  });
  const noiseGain = new Tone.Gain(0);
  noise.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(autoFilter);

  const detuneLfo = new Tone.LFO({
    frequency: 0.4,
    min: -5,
    max: 5,
    type: 'sine'
  });
  detuneLfo.connect(fundamental.detune);
  detuneLfo.connect(lowPartial.detune);
  detuneLfo.connect(highPartial.detune);

  fundamental.start();
  lowPartial.start();
  highPartial.start();
  noise.start();
  detuneLfo.start();

  dot.voice = {
    output,
    reverbSend,
    ampEnv,
    autoFilter,
    fundamentalGain,
    lowGain,
    highGain,
    fundamental,
    lowPartial,
    highPartial,
    noise,
    noiseGain,
    noiseFilter,
    detuneLfo,
    disposing: false
  };
}

function updateDotAudio(dot) {
  if (!dot.voice || dot.voice.disposing) {
    return;
  }

  const voice = dot.voice;
  const spectralFlux = THREE.MathUtils.clamp(dot.x, 0, 1);
  const brightness = THREE.MathUtils.clamp(dot.y, 0, 1);
  const transient = THREE.MathUtils.clamp(dot.z, 0, 1);

  const baseFrequency = 60 + brightness * 1800;
  voice.fundamental.frequency.rampTo(baseFrequency, 0.1);
  voice.lowPartial.frequency.rampTo(baseFrequency, 0.1);
  voice.highPartial.frequency.rampTo(baseFrequency, 0.1);

  let t1 = 1 - brightness * 0.7;
  let t2 = 0.25 + brightness * 0.4;
  let t3 = 0.15 + brightness * 0.9 + transient * 0.2;
  t1 = THREE.MathUtils.clamp(t1, 0.1, 1);
  t2 = THREE.MathUtils.clamp(t2, 0.05, 1);
  t3 = THREE.MathUtils.clamp(t3, 0.05, 1);
  const tristimulusSum = t1 + t2 + t3;
  const overallGain = 0.45 + (1 - transient) * 0.25;
  voice.fundamentalGain.gain.rampTo((t1 / tristimulusSum) * overallGain, 0.12);
  voice.lowGain.gain.rampTo((t2 / tristimulusSum) * overallGain, 0.12);
  voice.highGain.gain.rampTo((t3 / tristimulusSum) * overallGain, 0.12);

  const noiseAmount = transient;
  voice.noiseGain.gain.rampTo(noiseAmount * 0.55, 0.1);
  const minNoiseFreq = 500;
  const maxNoiseFreq = 9000;
  voice.noiseFilter.frequency.rampTo(minNoiseFreq + noiseAmount * (maxNoiseFreq - minNoiseFreq), 0.15);
  voice.noiseFilter.Q.rampTo(0.6 + (1 - noiseAmount) * 2.6, 0.15);
  voice.noise.type = noiseAmount > 0.55 ? 'white' : 'pink';

  voice.autoFilter.frequency.rampTo(0.15 + spectralFlux * 7.5, 0.2);
  voice.autoFilter.depth.rampTo(0.2 + spectralFlux * 0.75, 0.2);
  voice.autoFilter.baseFrequency = 180 + brightness * 6500;

  const detuneRange = 6 + spectralFlux * 48;
  voice.detuneLfo.min = -detuneRange;
  voice.detuneLfo.max = detuneRange;
  voice.detuneLfo.frequency.rampTo(0.2 + spectralFlux * 4.5, 0.2);

  voice.ampEnv.attack = 0.04 + transient * 0.25;
  voice.ampEnv.decay = 0.12 + transient * 0.4;
  voice.ampEnv.sustain = 0.45 + (1 - transient) * 0.35;
  voice.ampEnv.release = 0.35 + transient * 1.6;

  voice.reverbSend.gain.rampTo(0.08 + brightness * 0.15 + noiseAmount * 0.25, 0.2);
}

function disposeDotVoice(dot) {
  if (!dot.voice || dot.voice.disposing) {
    return;
  }

  const voice = dot.voice;
  voice.disposing = true;
  voice.ampEnv.triggerRelease();
  const releaseTail = voice.ampEnv.release + 0.4;

  setTimeout(() => {
    voice.autoFilter.stop();
    voice.detuneLfo.stop();
    voice.noise.stop();
    voice.fundamental.stop();
    voice.lowPartial.stop();
    voice.highPartial.stop();

    voice.detuneLfo.dispose();
    voice.autoFilter.dispose();
    voice.ampEnv.dispose();
    voice.fundamentalGain.dispose();
    voice.lowGain.dispose();
    voice.highGain.dispose();
    voice.fundamental.dispose();
    voice.lowPartial.dispose();
    voice.highPartial.dispose();
    voice.noiseGain.dispose();
    voice.noiseFilter.dispose();
    voice.noise.dispose();
    voice.output.dispose();
    voice.reverbSend.dispose();
  }, releaseTail * 1000);

  dot.voice = null;
}

function destroyDot(dot) {
  disposeDotVoice(dot);

  // Dispose of Three.js resources
  if (dot.mesh.geometry) {
    dot.mesh.geometry.dispose();
  }
  if (dot.mesh.material) {
    dot.mesh.material.dispose();
  }
  if (dot.shadow.geometry) {
    dot.shadow.geometry.dispose();
  }
  if (dot.shadow.material) {
    dot.shadow.material.dispose();
  }
  
  // Dispose of crosshairs
  if (dot.crosshairs) {
    dot.crosshairs.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
    cubeGroup.remove(dot.crosshairs);
  }
  
  // Remove from scene
  cubeGroup.remove(dot.mesh);
  cubeGroup.remove(dot.shadow);
  
  // Remove from dots array
  const index = dots.indexOf(dot);
  if (index > -1) {
    dots.splice(index, 1);
  }
}

// --- RAYCASTER FOR INTERACTION ---
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let draggedDot = null;
let draggedDotOutsideBounds = false; // Track if dragged dot went outside bounds
let wasDragging = false; // Track if we just finished dragging to prevent new dot creation
let draggingHandle = false;
let lastMouseX = 0;
let lastMouseY = 0;
const dragPlane = new THREE.Plane();
const dragPoint = new THREE.Vector3();

function getIntersectionPoint(raycaster) {
  // First check if mouse is over the cube at all
  const boxIntersects = raycaster.intersectObject(invisibleCube);
  
  if (boxIntersects.length === 0) {
    return null; // Not pointing at cube - hide crosshairs
  }
  
  // Create a plane perpendicular to the camera view that goes through a point in the cube
  // The depth is determined by the mouse's vertical position on screen
  // This allows us to "scan" through the cube's depth by moving the mouse up/down
  
  const cameraDir = new THREE.Vector3();
  camera.getWorldDirection(cameraDir);
  
  // Map mouse Y position (-1 to 1) to depth in cube (-cubeSize/2 to cubeSize/2)
  // More intuitive: mouse at top of cube = far side, mouse at bottom = near side
  const depthT = (mouse.y + 1) / 2; // Convert -1,1 to 0,1
  const depthInCube = -cubeSize/2 + depthT * cubeSize; // Map to cube depth
  
  // Create a point at this depth along the camera's view direction
  const cubeCenter = new THREE.Vector3(0, 0, 0);
  const depthPoint = cubeCenter.clone().addScaledVector(cameraDir, depthInCube * 0.5);
  
  // Create plane through this depth point, perpendicular to camera
  const planeNormal = cameraDir.clone().negate();
  const plane = new THREE.Plane();
  plane.setFromNormalAndCoplanarPoint(planeNormal, depthPoint);
  
  // Intersect ray with this plane
  const planeIntersect = new THREE.Vector3();
  const hasPlaneIntersect = raycaster.ray.intersectPlane(plane, planeIntersect);
  
  if (!hasPlaneIntersect) {
    return null;
  }
  
  // Transform to local coordinates
  const intersectLocal = planeIntersect.clone();
  intersectLocal.sub(cubeGroup.position);
  intersectLocal.applyQuaternion(cubeGroup.quaternion.clone().invert());
  
  // Clamp to cube bounds
  const halfSize = cubeSize / 2;
  intersectLocal.x = Math.max(-halfSize, Math.min(halfSize, intersectLocal.x));
  intersectLocal.y = Math.max(-halfSize, Math.min(halfSize, intersectLocal.y));
  intersectLocal.z = Math.max(-halfSize, Math.min(halfSize, intersectLocal.z));
  
  return intersectLocal;
}

function onCanvasClick(event) {
  // Don't create a new dot if we just finished dragging
  if (wasDragging) {
    wasDragging = false;
    event.preventDefault();
    return;
  }

  if (Tone.context.state !== 'running') {
    Tone.start();
  }
  
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const point = getIntersectionPoint(raycaster);

  if (point) {
    addDotAtPoint(point);
  }
}

function addDotAtPoint(point) {
  // Create a small cube instead of sphere
  const dotGeometry = new THREE.BoxGeometry(0.225, 0.225, 0.225);
  const dotMaterial = new THREE.MeshPhysicalMaterial({ 
    color: 0xff0088,
    emissive: 0xff0088,
    emissiveIntensity: 0.5,
    metalness: 0.8,
    roughness: 0.2,
    clearcoat: 1.0,
    clearcoatRoughness: 0.1
  });
  const dotMesh = new THREE.Mesh(dotGeometry, dotMaterial);
  dotMesh.position.copy(point);
  dotMesh.castShadow = true;
  dotMesh.receiveShadow = true;
  dotMesh.renderOrder = 0; // Render cubes first
  cubeGroup.add(dotMesh);
  
  // Create a shadow plane that projects straight down to the bottom wall
  const shadowGeometry = new THREE.PlaneGeometry(0.2, 0.2);
  const shadowMaterial = new THREE.ShadowMaterial({ opacity: 0.4 });
  const shadowPlane = new THREE.Mesh(shadowGeometry, shadowMaterial);
  shadowPlane.receiveShadow = true;
  
  // Position shadow directly below the dot on the bottom wall (Y = -cubeSize/2)
  shadowPlane.position.set(point.x, -cubeSize/2, point.z);
  shadowPlane.rotation.x = Math.PI / 2; // Rotate to be horizontal on the bottom
  cubeGroup.add(shadowPlane);
  
  // Map 3D position to timbre parameters
  // X-axis: Spectral Flux (-1 to 1 normalized to 0-1)
  // Y-axis: Brightness (-1 to 1 normalized to 0-1)  
  // Z-axis: Transients / noise ratio (-1 to 1 normalized to 0-1)
  let x = (point.x + cubeSize/2) / cubeSize;
  let y = (point.y + cubeSize/2) / cubeSize;
  let z = (point.z + cubeSize/2) / cubeSize;
  
  x = Math.max(0, Math.min(1, x));
  y = Math.max(0, Math.min(1, y));
  z = Math.max(0, Math.min(1, z));
  
  // Create permanent crosshairs for this dot
  const crosshairs = createHoverLines(point, true);
  cubeGroup.add(crosshairs);
  
  const dotId = dotIdCounter++;
  const dot = { mesh: dotMesh, shadow: shadowPlane, crosshairs: crosshairs, x, y, z, id: dotId };
  
  dots.push(dot);
  createDotVoice(dot);
  updateDotAudio(dot);
  if (dot.voice) {
    dot.voice.ampEnv.triggerAttack();
  }
}

function onMouseDown(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  
  lastMouseX = event.clientX;
  lastMouseY = event.clientY;

  raycaster.setFromCamera(mouse, camera);
  
  // Check if any handle was clicked
  const handleIntersects = raycaster.intersectObjects(handleBalls);
  if (handleIntersects.length > 0) {
    draggingHandle = true;
    event.preventDefault();
    return;
  }
  
  const dotMeshes = dots.map(d => d.mesh);
  const intersects = raycaster.intersectObjects(dotMeshes);
  
  if (intersects.length > 0) {
    const clickedMesh = intersects[0].object;
    draggedDot = dots.find(d => d.mesh === clickedMesh);
    
    if (draggedDot) {
      wasDragging = false; // Reset flag at start of potential drag
      dragPlane.setFromNormalAndCoplanarPoint(
        camera.getWorldDirection(new THREE.Vector3()),
        draggedDot.mesh.position
      );
      event.preventDefault();
    }
  }
}

function onMouseMove(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  // Handle cube rotation ONLY if dragging the handle AND mouse button is pressed
  if (draggingHandle && (event.buttons & 1)) { // Check if left mouse button is pressed
    wasDragging = true; // Mark that we're dragging the handle
    const deltaX = event.clientX - lastMouseX;
    const deltaY = event.clientY - lastMouseY;
    cubeGroup.rotation.y += deltaX * 0.005;
    cubeGroup.rotation.x += deltaY * 0.005;
    lastMouseX = event.clientX;
    lastMouseY = event.clientY;
  } else if (draggingHandle && !(event.buttons & 1)) {
    // Stop dragging if button is released
    draggingHandle = false;
    return;
  }
  
  if (draggingHandle) return;

  if (draggedDot) {
    wasDragging = true; // Mark that we're in a drag operation
    raycaster.setFromCamera(mouse, camera);
    raycaster.ray.intersectPlane(dragPlane, dragPoint);
    
    // Check if the dot is being dragged outside the cube bounds
    draggedDotOutsideBounds = dragPoint.x < -cubeSize/2 || dragPoint.x > cubeSize/2 ||
                              dragPoint.y < -cubeSize/2 || dragPoint.y > cubeSize/2 ||
                              dragPoint.z < -cubeSize/2 || dragPoint.z > cubeSize/2;
    
    // If outside bounds, show visual indicator but don't move or destroy yet
    if (draggedDotOutsideBounds) {
      draggedDot.mesh.visible = false; // Hide the dot while outside
      return; // Wait for mouse up to destroy
    }
    
    // Only move if within bounds
    dragPoint.x = Math.max(-cubeSize/2, Math.min(cubeSize/2, dragPoint.x));
    dragPoint.y = Math.max(-cubeSize/2, Math.min(cubeSize/2, dragPoint.y));
    dragPoint.z = Math.max(-cubeSize/2, Math.min(cubeSize/2, dragPoint.z));
    
    draggedDot.mesh.visible = true; // Show the dot again if it comes back
    draggedDot.mesh.position.copy(dragPoint);
    
    // Update shadow position to follow the dot
    draggedDot.shadow.position.set(dragPoint.x, -cubeSize/2, dragPoint.z);
    
    // Update crosshairs position to follow the dot
    if (draggedDot.crosshairs) {
      cubeGroup.remove(draggedDot.crosshairs);
      draggedDot.crosshairs = createHoverLines(dragPoint, true);
      cubeGroup.add(draggedDot.crosshairs);
    }
    
    // Update all 3D coordinates based on position in volume
    draggedDot.x = (dragPoint.x + cubeSize/2) / cubeSize;
    draggedDot.y = (dragPoint.y + cubeSize/2) / cubeSize;
    draggedDot.z = (dragPoint.z + cubeSize/2) / cubeSize;
    
    draggedDot.x = Math.max(0, Math.min(1, draggedDot.x));
    draggedDot.y = Math.max(0, Math.min(1, draggedDot.y));
    draggedDot.z = Math.max(0, Math.min(1, draggedDot.z));
    
    updateDotAudio(draggedDot);
    return; // Don't show hover lines while dragging (permanent crosshairs are shown)
  }
  
  raycaster.setFromCamera(mouse, camera);
  const intersectPoint = getIntersectionPoint(raycaster);
  
  // Update hover visualization
  if (hoverLines) {
    cubeGroup.remove(hoverLines);
    hoverLines = null;
  }
  
  if (intersectPoint) {
    hoverLines = createHoverLines(intersectPoint);
    cubeGroup.add(hoverLines);
  }
}

function createHoverLines(point, isPermanent = false) {
  const group = new THREE.Group();
  const lineColor = 0xffff00;
  const opacity = isPermanent ? 0.4 : 0.8; // More transparent for permanent crosshairs
  const extension = 0.05; // Extend lines slightly past walls
  const cubeHalfSize = 0.225 / 2; // Half the size of placed cubes (0.1125)
  
  // Create three simple lines from dot to each wall
  // Line to left wall (X = -cubeSize/2)
  const toLeftWall = new THREE.BufferGeometry();
  toLeftWall.setAttribute('position', new THREE.BufferAttribute(
    new Float32Array([
      point.x, point.y, point.z,
      -cubeSize/2 - extension, point.y, point.z
    ]), 3
  ));
  const leftWallLine = new THREE.Line(toLeftWall, new THREE.LineBasicMaterial({ 
    color: lineColor, 
    linewidth: 2,
    depthTest: false,
    transparent: true,
    opacity: opacity
  }));
  leftWallLine.renderOrder = 1; // Render lines after cubes
  group.add(leftWallLine);
  
  // Line to bottom wall (Y = -cubeSize/2)
  const toBottomWall = new THREE.BufferGeometry();
  toBottomWall.setAttribute('position', new THREE.BufferAttribute(
    new Float32Array([
      point.x, point.y, point.z,
      point.x, -cubeSize/2 - extension, point.z
    ]), 3
  ));
  const bottomWallLine = new THREE.Line(toBottomWall, new THREE.LineBasicMaterial({ 
    color: lineColor, 
    linewidth: 2,
    depthTest: false,
    transparent: true,
    opacity: opacity
  }));
  bottomWallLine.renderOrder = 1; // Render lines after cubes
  group.add(bottomWallLine);
  
  // Line to back wall (Z = -cubeSize/2)
  const toBackWall = new THREE.BufferGeometry();
  toBackWall.setAttribute('position', new THREE.BufferAttribute(
    new Float32Array([
      point.x, point.y, point.z,
      point.x, point.y, -cubeSize/2 - extension
    ]), 3
  ));
  const backWallLine = new THREE.Line(toBackWall, new THREE.LineBasicMaterial({ 
    color: lineColor, 
    linewidth: 2,
    depthTest: false,
    transparent: true,
    opacity: opacity
  }));
  backWallLine.renderOrder = 1; // Render lines after cubes
  group.add(backWallLine);
  
  // Mark as permanent and add pulse orbs for animation
  if (isPermanent) {
    group.userData.isPermanent = true;
    group.userData.basePosition = point.clone();
    
    // Create three elongated glowing orbs for pulse animation (thinner and longer)
    for (let i = 0; i < 3; i++) {
      let pulseGeometry;
      // Create elongated sphere based on axis direction
      if (i === 0) { // X axis - elongated horizontally
        pulseGeometry = new THREE.SphereGeometry(0.01, 8, 8);
        pulseGeometry.scale(10, 1, 1); // Stretch along X
      } else if (i === 1) { // Y axis - elongated vertically
        pulseGeometry = new THREE.SphereGeometry(0.01, 8, 8);
        pulseGeometry.scale(1, 10, 1); // Stretch along Y
      } else { // Z axis - elongated in Z
        pulseGeometry = new THREE.SphereGeometry(0.01, 8, 8);
        pulseGeometry.scale(1, 1, 10); // Stretch along Z
      }
      
      const pulseMaterial = new THREE.MeshBasicMaterial({ 
        color: 0xffff00,
        transparent: true,
        opacity: 0.6
      });
      
      const pulse = new THREE.Mesh(pulseGeometry, pulseMaterial);
      pulse.position.copy(point);
      pulse.userData.isPulse = true;
      pulse.userData.axis = i; // 0=X, 1=Y, 2=Z
      group.add(pulse);
      
      // Create a ripple ring for impact effect
      const ringGeometry = new THREE.RingGeometry(0.025, 0.04, 16);
      const ringMaterial = new THREE.MeshBasicMaterial({
        color: 0xffff00,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide
      });
      const ripple = new THREE.Mesh(ringGeometry, ringMaterial);
      ripple.userData.isRipple = true;
      ripple.userData.axis = i;
      ripple.userData.scale = 0;
      group.add(ripple);
    }
  }
  
  return group;
}

function onMouseUp(event) {
  // If the dragged dot was outside bounds when released, destroy it
  if (draggedDot && draggedDotOutsideBounds) {
    destroyDot(draggedDot);
  }
  
  draggedDot = null;
  draggedDotOutsideBounds = false;
  draggingHandle = false;
}

// --- VR INTERACTION HANDLERS ---
function onVRSelectStart(event) {
  const controller = event.target;
  const tempMatrix = new THREE.Matrix4();
  tempMatrix.identity().extractRotation(controller.matrixWorld);
  
  const raycaster = new THREE.Raycaster();
  raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
  raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);
  
  // Check for handle grab first
  const handleIntersects = raycaster.intersectObjects(handleBalls);
  if (handleIntersects.length > 0) {
    vrDraggedHandle = handleIntersects[0].object;
    vrDraggedController = controller;
    controller.userData.lastControllerPos = new THREE.Vector3().setFromMatrixPosition(controller.matrixWorld);
    return;
  }
  
  // Check for dot drag
  const dotMeshes = dots.map(d => d.mesh);
  const intersects = raycaster.intersectObjects(dotMeshes);
  
  if (intersects.length > 0) {
    const clickedMesh = intersects[0].object;
    vrDraggedDot = dots.find(d => d.mesh === clickedMesh);
    vrDraggedController = controller;
  }
}

function onVRSelectEnd(event) {
  const controller = event.target;
  if (vrDraggedController === controller) {
    vrDraggedDot = null;
    vrDraggedHandle = null;
    vrDraggedController = null;
    if (controller.userData.lastControllerPos) {
      delete controller.userData.lastControllerPos;
    }
  }
}

function onHandPinchStart(event) {
  const hand = event.target;
  
  const indexTip = hand.joints['index-finger-tip'];
  if (!indexTip) return;
  
  const raycaster = new THREE.Raycaster();
  const tipPosition = new THREE.Vector3();
  indexTip.getWorldPosition(tipPosition);
  
  const thumbTip = hand.joints['thumb-tip'];
  const direction = new THREE.Vector3();
  if (thumbTip) {
    const thumbPosition = new THREE.Vector3();
    thumbTip.getWorldPosition(thumbPosition);
    direction.subVectors(tipPosition, thumbPosition).normalize();
  } else {
    direction.set(0, 0, -1);
  }
  
  raycaster.set(tipPosition, direction);
  
  // Check for UI button clicks first
  if (vrUIPanel) {
    const buttons = vrUIPanel.children;
    const uiIntersects = raycaster.intersectObjects(buttons);
    if (uiIntersects.length > 0) {
      const button = uiIntersects[0].object;
      const action = button.userData.buttonAction;
      
      if (action === 'download') {
        const link = document.createElement('a');
        link.download = 'spectrograph.png';
        link.href = spectroCanvas.toDataURL();
        link.click();
      } else if (action === 'clear') {
        while (dots.length > 0) {
          destroyDot(dots[0]);
        }
      } else if (action === 'reset') {
        cubeGroup.rotation.x = 0;
        cubeGroup.rotation.y = Math.PI / 12;
        cubeGroup.rotation.z = 0;
      }
      return;
    }
  }
  
  // Check for handle grab first
  const handleIntersects = raycaster.intersectObjects(handleBalls);
  if (handleIntersects.length > 0) {
    vrDraggedHandle = handleIntersects[0].object;
    vrDraggedHandRotating = hand;
    return;
  }
  
  // Check for existing dot drag
  const dotMeshes = dots.map(d => d.mesh);
  const intersects = raycaster.intersectObjects(dotMeshes);
  
  if (intersects.length > 0) {
    const clickedMesh = intersects[0].object;
    vrDraggedDot = dots.find(d => d.mesh === clickedMesh);
    vrDraggedHand = hand;
    return; // Don't place new dot when dragging
  }
  
  // ONLY place new dot if pointing at the cube (matching mouse behavior)
  const point = getIntersectionPointFromRay(raycaster);
  if (point) {
    if (Tone.context.state !== 'running') {
      Tone.start();
    }
    addDotAtPoint(point);
  }
  // If point is null (not pointing at cube), do nothing - just like mouse click
}

function onHandPinchEnd(event) {
  if (vrDraggedDot && vrDraggedHand === event.target) {
    vrDraggedDot = null;
    vrDraggedHand = null;
  }
  if (vrDraggedHandRotating === event.target) {
    vrDraggedHandle = null;
    vrDraggedHandRotating = null;
  }
}

function getIntersectionPointFromRay(raycaster) {
  const boxIntersects = raycaster.intersectObject(invisibleCube);
  if (boxIntersects.length === 0) return null;
  
  const intersectPoint = boxIntersects[0].point;
  const intersectLocal = intersectPoint.clone();
  intersectLocal.sub(cubeGroup.position);
  intersectLocal.applyQuaternion(cubeGroup.quaternion.clone().invert());
  
  const halfSize = cubeSize / 2;
  intersectLocal.x = Math.max(-halfSize, Math.min(halfSize, intersectLocal.x));
  intersectLocal.y = Math.max(-halfSize, Math.min(halfSize, intersectLocal.y));
  intersectLocal.z = Math.max(-halfSize, Math.min(halfSize, intersectLocal.z));
  
  return intersectLocal;
}

function onVRSelect(event) {
  if (vrDraggedDot) return; // Was dragging, don't place new dot
  
  const controller = event.target;
  
  // Check for UI button clicks first
  handleVRUIClick(controller);
  
  const tempMatrix = new THREE.Matrix4();
  tempMatrix.identity().extractRotation(controller.matrixWorld);
  
  const raycaster = new THREE.Raycaster();
  raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
  raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);
  
  const intersects = raycaster.intersectObject(invisibleCube);
  
  if (intersects.length > 0) {
    // Convert world intersection to local cube coordinates
    const worldPoint = intersects[0].point;
    const localPoint = cubeGroup.worldToLocal(worldPoint.clone());
    
    // Clamp to cube bounds
    const halfSize = cubeSize / 2;
    localPoint.x = Math.max(-halfSize, Math.min(halfSize, localPoint.x));
    localPoint.y = Math.max(-halfSize, Math.min(halfSize, localPoint.y));
    localPoint.z = Math.max(-halfSize, Math.min(halfSize, localPoint.z));
    
    if (Tone.context.state !== 'running') {
      Tone.start();
    }
    
    addDotAtPoint(localPoint);
  }
}

function handleVRControllerRaycast(controller, index) {
  // Handle rotation with controller
  if (vrDraggedHandle && vrDraggedController === controller) {
    const currentPos = new THREE.Vector3().setFromMatrixPosition(controller.matrixWorld);
    
    if (controller.userData.lastControllerPos) {
      const delta = currentPos.clone().sub(controller.userData.lastControllerPos);
      // Rotate cube based on controller movement
      cubeGroup.rotation.y += delta.x * 3;
      cubeGroup.rotation.x -= delta.y * 3;
      controller.userData.lastControllerPos.copy(currentPos);
    } else {
      controller.userData.lastControllerPos = currentPos.clone();
    }
    return;
  }
  
  // Handle dot dragging with controller
  if (vrDraggedDot && vrDraggedController === controller) {
    const tempMatrix = new THREE.Matrix4();
    tempMatrix.identity().extractRotation(controller.matrixWorld);
    
    const raycaster = new THREE.Raycaster();
    raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);
    
    const intersects = raycaster.intersectObject(invisibleCube);
    
    if (intersects.length > 0) {
      const worldPoint = intersects[0].point;
      const localPoint = cubeGroup.worldToLocal(worldPoint.clone());
      
      const halfSize = cubeSize / 2;
      const outsideBounds = localPoint.x < -halfSize || localPoint.x > halfSize ||
                           localPoint.y < -halfSize || localPoint.y > halfSize ||
                           localPoint.z < -halfSize || localPoint.z > halfSize;
      
      if (outsideBounds) {
        vrDraggedDot.mesh.visible = false;
        return;
      }
      
      localPoint.x = Math.max(-halfSize, Math.min(halfSize, localPoint.x));
      localPoint.y = Math.max(-halfSize, Math.min(halfSize, localPoint.y));
      localPoint.z = Math.max(-halfSize, Math.min(halfSize, localPoint.z));
      
      vrDraggedDot.mesh.visible = true;
      vrDraggedDot.mesh.position.copy(localPoint);
      vrDraggedDot.shadow.position.set(localPoint.x, -halfSize, localPoint.z);
      
      if (vrDraggedDot.crosshairs) {
        cubeGroup.remove(vrDraggedDot.crosshairs);
        vrDraggedDot.crosshairs = createHoverLines(localPoint, true);
        cubeGroup.add(vrDraggedDot.crosshairs);
      }
      
      vrDraggedDot.x = (localPoint.x + halfSize) / cubeSize;
      vrDraggedDot.y = (localPoint.y + halfSize) / cubeSize;
      vrDraggedDot.z = (localPoint.z + halfSize) / cubeSize;
      
      vrDraggedDot.x = Math.max(0, Math.min(1, vrDraggedDot.x));
      vrDraggedDot.y = Math.max(0, Math.min(1, vrDraggedDot.y));
      vrDraggedDot.z = Math.max(0, Math.min(1, vrDraggedDot.z));
      
      updateDotAudio(vrDraggedDot);
    }
  }
}

renderer.domElement.addEventListener('click', onCanvasClick);
renderer.domElement.addEventListener('mousedown', onMouseDown);
renderer.domElement.addEventListener('mousemove', onMouseMove);
renderer.domElement.addEventListener('mouseup', onMouseUp);

const spectroCanvas = document.getElementById('spectrograph');
const ctx = spectroCanvas.getContext('2d');
const bufferLength = analyser.frequencyBinCount;
const dataArray = new Uint8Array(bufferLength);

// Calculate frequency for each bin based on sample rate
// Nyquist frequency = sample rate / 2
const nyquistFreq = Tone.context.sampleRate / 2;

function drawSpectrograph() {
  requestAnimationFrame(drawSpectrograph);
  analyser.getByteFrequencyData(dataArray);

  const maxFreq = 8000; // Maximum frequency to display
  const labelHeight = 18;
  const barMaxHeight = spectroCanvas.height - labelHeight;

  // Fill background
  ctx.fillStyle = '#333333';
  ctx.fillRect(0, 0, spectroCanvas.width, spectroCanvas.height);

  const minFreq = 20;
  const logMin = Math.log10(minFreq);
  const logMax = Math.log10(maxFreq);
  const minDb = -60;

  // Draw frequency bars first using logarithmic spacing
  for (let i = 0; i < bufferLength; i++) {
    const freq = (i / bufferLength) * nyquistFreq;
    if (freq < minFreq) continue;
    if (freq > maxFreq) break;

    const clampedFreq = Math.max(freq, minFreq);
    const logPos = (Math.log10(clampedFreq) - logMin) / (logMax - logMin);
    const xPos = logPos * spectroCanvas.width;

    const nextFreqRaw = ((i + 1) / bufferLength) * nyquistFreq;
    const clampedNextFreq = Math.min(Math.max(nextFreqRaw, minFreq), maxFreq);
    const nextLogPos = (Math.log10(clampedNextFreq) - logMin) / (logMax - logMin);
    const nextX = nextLogPos * spectroCanvas.width;
    const barWidth = Math.max(1, nextX - xPos);

    const magnitude = dataArray[i] / 255;
    const db = 20 * Math.log10(magnitude > 0 ? magnitude : 1e-4);
    const normalizedDb = Math.min(1, Math.max(0, (db - minDb) / (0 - minDb)));
    const barHeight = normalizedDb * barMaxHeight;

    const hue = (Math.log10(clampedFreq) - logMin) / (logMax - logMin) * 240;
    ctx.fillStyle = `hsl(${240 - hue}, 100%, 50%)`;

    ctx.fillRect(xPos, barMaxHeight - barHeight, barWidth, barHeight);
  }
  
  // Draw separator line
  ctx.strokeStyle = '#555';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, barMaxHeight);
  ctx.lineTo(spectroCanvas.width, barMaxHeight);
  ctx.stroke();

  // Draw frequency labels at the bottom
  ctx.fillStyle = '#aaa';
  ctx.font = '11px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  
  const labels = ['0', '1k', '2k', '4k', '8k'];
  const frequencies = [0, 1000, 2000, 4000, 8000];
  
  labels.forEach((label, i) => {
    const xPos = (frequencies[i] / maxFreq) * spectroCanvas.width;
    ctx.fillText(label, xPos, barMaxHeight + 2);
  });
}
drawSpectrograph();

// --- ANIMATION LOOP ---
let vrUIPanel = null;
let vrSpectrographPlane = null;
let vrSpectrographTexture = null;

function createVRUI() {
  if (vrUIPanel) return; // Already created
  
  // Create 3D button panel
  const panelGroup = new THREE.Group();
  const buttonWidth = 0.3;
  const buttonHeight = 0.1;
  const buttonSpacing = 0.02;
  
  function createButton(text, color, index) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 85;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 32px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);
    
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
    const geometry = new THREE.PlaneGeometry(buttonWidth, buttonHeight);
    const button = new THREE.Mesh(geometry, material);
    button.position.y = -index * (buttonHeight + buttonSpacing);
    button.userData.buttonAction = text.toLowerCase();
    return button;
  }
  
  const downloadBtn = createButton('Download', '#4CAF50', 0);
  const clearBtn = createButton('Clear', '#f44336', 1);
  const resetBtn = createButton('Reset', '#2196F3', 2);
  
  panelGroup.add(downloadBtn);
  panelGroup.add(clearBtn);
  panelGroup.add(resetBtn);
  panelGroup.position.set(-1.5, 1.5, -1);
  panelGroup.lookAt(camera.position);
  scene.add(panelGroup);
  vrUIPanel = panelGroup;
  
  // Create floating spectrograph
  vrSpectrographTexture = new THREE.CanvasTexture(spectroCanvas);
  const spectroMaterial = new THREE.MeshBasicMaterial({ 
    map: vrSpectrographTexture,
    side: THREE.DoubleSide
  });
  const spectroGeometry = new THREE.PlaneGeometry(0.8, 0.5);
  vrSpectrographPlane = new THREE.Mesh(spectroGeometry, spectroMaterial);
  vrSpectrographPlane.position.set(1.5, 1.5, -1);
  vrSpectrographPlane.lookAt(camera.position);
  scene.add(vrSpectrographPlane);
}

function removeVRUI() {
  if (vrUIPanel) {
    scene.remove(vrUIPanel);
    vrUIPanel.traverse(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (child.material.map) child.material.map.dispose();
        child.material.dispose();
      }
    });
    vrUIPanel = null;
  }
  if (vrSpectrographPlane) {
    scene.remove(vrSpectrographPlane);
    if (vrSpectrographPlane.geometry) vrSpectrographPlane.geometry.dispose();
    if (vrSpectrographPlane.material) {
      if (vrSpectrographPlane.material.map) vrSpectrographPlane.material.map.dispose();
      vrSpectrographPlane.material.dispose();
    }
    vrSpectrographPlane = null;
    vrSpectrographTexture = null;
  }
}

function handleVRUIClick(controller) {
  if (!vrUIPanel) return;
  
  const tempMatrix = new THREE.Matrix4();
  tempMatrix.identity().extractRotation(controller.matrixWorld);
  
  const raycaster = new THREE.Raycaster();
  raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
  raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);
  
  const buttons = vrUIPanel.children;
  const intersects = raycaster.intersectObjects(buttons);
  
  if (intersects.length > 0) {
    const button = intersects[0].object;
    const action = button.userData.buttonAction;
    
    if (action === 'download') {
      const link = document.createElement('a');
      link.download = 'spectrograph.png';
      link.href = spectroCanvas.toDataURL();
      link.click();
    } else if (action === 'clear') {
      while (dots.length > 0) {
        destroyDot(dots[0]);
      }
    } else if (action === 'reset') {
      cubeGroup.rotation.x = 0;
      cubeGroup.rotation.y = Math.PI / 12;
      cubeGroup.rotation.z = 0;
    }
  }
}

function animate() {
  // VR setup/teardown
  if (renderer.xr.isPresenting && !vrUIPanel) {
    createVRUI();
  } else if (!renderer.xr.isPresenting && vrUIPanel) {
    removeVRUI();
  }
  
  // Update spectrograph texture in VR
  if (vrSpectrographTexture && renderer.xr.isPresenting) {
    vrSpectrographTexture.needsUpdate = true;
  }
  
  // Update hand joint visualizations and show hover crosshairs
  hands.forEach((hand, index) => {
    if (hand && hand.joints) {
      const handModel = handModels[index];
      if (handModel) {
        Object.keys(hand.joints).forEach(jointName => {
          const joint = hand.joints[jointName];
          if (joint && handModel.spheres[jointName]) {
            const sphere = handModel.spheres[jointName];
            sphere.position.copy(joint.position);
            sphere.quaternion.copy(joint.quaternion);
            sphere.visible = renderer.xr.isPresenting;
          }
        });
      }
      
      // Show hover crosshairs when not dragging (matching mouse behavior)
      if (renderer.xr.isPresenting && !vrDraggedDot && !vrDraggedHandle) {
        const indexTip = hand.joints['index-finger-tip'];
        if (indexTip) {
          const raycaster = new THREE.Raycaster();
          const tipPosition = new THREE.Vector3();
          indexTip.getWorldPosition(tipPosition);
          
          const thumbTip = hand.joints['thumb-tip'];
          const direction = new THREE.Vector3();
          if (thumbTip) {
            const thumbPosition = new THREE.Vector3();
            thumbTip.getWorldPosition(thumbPosition);
            direction.subVectors(tipPosition, thumbPosition).normalize();
          } else {
            direction.set(0, 0, -1);
          }
          
          raycaster.set(tipPosition, direction);
          const point = getIntersectionPointFromRay(raycaster);
          
          // Determine which hover lines to update (left or right hand)
          const vrHoverLines = index === 0 ? vrHoverLinesLeft : vrHoverLinesRight;
          const isLeft = index === 0;
          
          // Remove old hover lines for this hand
          if (isLeft && vrHoverLinesLeft) {
            cubeGroup.remove(vrHoverLinesLeft);
            vrHoverLinesLeft = null;
          } else if (!isLeft && vrHoverLinesRight) {
            cubeGroup.remove(vrHoverLinesRight);
            vrHoverLinesRight = null;
          }
          
          // Create new hover lines if pointing at cube
          if (point) {
            const newHoverLines = createHoverLines(point);
            cubeGroup.add(newHoverLines);
            if (isLeft) {
              vrHoverLinesLeft = newHoverLines;
            } else {
              vrHoverLinesRight = newHoverLines;
            }
          }
        }
      }
    }
  });
  
  // Clear VR hover lines when dragging starts
  if ((vrDraggedDot || vrDraggedHandle) && vrHoverLinesLeft) {
    cubeGroup.remove(vrHoverLinesLeft);
    vrHoverLinesLeft = null;
  }
  if ((vrDraggedDot || vrDraggedHandle) && vrHoverLinesRight) {
    cubeGroup.remove(vrHoverLinesRight);
    vrHoverLinesRight = null;
  }
  
  // Handle rotation with hands
  if (vrDraggedHandle && vrDraggedHandRotating) {
    const indexTip = vrDraggedHandRotating.joints['index-finger-tip'];
    if (indexTip) {
      const currentPos = new THREE.Vector3();
      indexTip.getWorldPosition(currentPos);
      
      if (!vrDraggedHandRotating.userData.lastHandPos) {
        vrDraggedHandRotating.userData.lastHandPos = currentPos.clone();
      } else {
        const delta = currentPos.clone().sub(vrDraggedHandRotating.userData.lastHandPos);
        cubeGroup.rotation.y += delta.x * 2;
        cubeGroup.rotation.x += delta.y * 2;
        vrDraggedHandRotating.userData.lastHandPos.copy(currentPos);
      }
    }
  } else if (vrDraggedHandRotating) {
    vrDraggedHandRotating.userData.lastHandPos = null;
  }
  
  // Handle hand dragging
  if (vrDraggedDot && vrDraggedHand) {
    const indexTip = vrDraggedHand.joints['index-finger-tip'];
    if (indexTip) {
      const raycaster = new THREE.Raycaster();
      const tipPosition = new THREE.Vector3();
      indexTip.getWorldPosition(tipPosition);
      
      const thumbTip = vrDraggedHand.joints['thumb-tip'];
      const direction = new THREE.Vector3();
      if (thumbTip) {
        const thumbPosition = new THREE.Vector3();
        thumbTip.getWorldPosition(thumbPosition);
        direction.subVectors(tipPosition, thumbPosition).normalize();
      } else {
        direction.set(0, 0, -1);
      }
      
      raycaster.set(tipPosition, direction);
      const point = getIntersectionPointFromRay(raycaster);
      
      if (point) {
        const worldPoint = point.clone();
        worldPoint.applyQuaternion(cubeGroup.quaternion);
        worldPoint.add(cubeGroup.position);
        
        vrDraggedDot.mesh.position.copy(worldPoint);
        vrDraggedDot.shadow.position.set(point.x, -cubeSize/2, point.z);
        
        if (vrDraggedDot.crosshairs) {
          cubeGroup.remove(vrDraggedDot.crosshairs);
          vrDraggedDot.crosshairs = createHoverLines(point, true);
          cubeGroup.add(vrDraggedDot.crosshairs);
        }
        
        const halfSize = cubeSize / 2;
        vrDraggedDot.x = (point.x + halfSize) / cubeSize;
        vrDraggedDot.y = (point.y + halfSize) / cubeSize;
        vrDraggedDot.z = (point.z + halfSize) / cubeSize;
        
        vrDraggedDot.x = Math.max(0, Math.min(1, vrDraggedDot.x));
        vrDraggedDot.y = Math.max(0, Math.min(1, vrDraggedDot.y));
        vrDraggedDot.z = Math.max(0, Math.min(1, vrDraggedDot.z));
        
        updateDotAudio(vrDraggedDot);
      }
    }
  }
  
  // Update VR UI and spectrograph positions to follow camera
  if (renderer.xr.isPresenting && vrSpectrographPlane) {
    const camera = renderer.xr.getCamera();
    
    // Get camera direction
    const cameraDirection = new THREE.Vector3();
    camera.getWorldDirection(cameraDirection);
    
    // Position spectrograph behind the cube from camera's perspective
    const distanceBehindCube = 3.5;
    const spectroPos = cubeGroup.position.clone();
    spectroPos.add(cameraDirection.multiplyScalar(-distanceBehindCube));
    vrSpectrographPlane.position.copy(spectroPos);
    vrSpectrographPlane.lookAt(camera.position);
    
    // Keep UI panel in a fixed position relative to cube
    if (vrUIPanel) {
      const uiPos = cubeGroup.position.clone();
      const rightOffset = new THREE.Vector3();
      camera.getWorldDirection(rightOffset);
      rightOffset.cross(camera.up).normalize().multiplyScalar(-2);
      const upOffset = camera.up.clone().normalize().multiplyScalar(1.5);
      uiPos.add(rightOffset).add(upOffset);
      vrUIPanel.position.copy(uiPos);
      vrUIPanel.lookAt(camera.position);
    }
  }
  
  // VR controller raycasting - check each frame for interaction
  if (renderer.xr.isPresenting) {
    controllers.forEach((controller, index) => {
      if (controller && controller.visible) {
        handleVRControllerRaycast(controller, index);
      }
    });
  }
  
  // Flip Spectral Flux label based on viewing angle
  // No longer needed - we have two separate labels facing opposite directions
  
  // Animate pulse orbs traveling along crosshairs
  const time = Date.now() * 0.0003; // Even slower (was 0.0005)
  const center = new THREE.Vector3(0, 0, 0); // Center of cube
  dots.forEach(dot => {
    if (dot.crosshairs && dot.crosshairs.userData.isPermanent) {
      const basePos = dot.crosshairs.userData.basePosition;
      
      // Update pulse orbs position along each axis
      dot.crosshairs.children.forEach((child) => {
        if (child.userData.isPulse) {
          const axis = child.userData.axis;
          const t = (time + dot.id * 0.5 + axis * 2) % 1; // 0 to 1 repeating (not oscillating)
          
          if (axis === 0) { // X axis - from center to left wall through dot
            const totalDistance = center.x - (-cubeSize/2);
            const targetX = center.x - t * totalDistance;
            child.position.set(targetX, basePos.y, basePos.z);
          } else if (axis === 1) { // Y axis - from center to bottom wall through dot
            const totalDistance = center.y - (-cubeSize/2);
            const targetY = center.y - t * totalDistance;
            child.position.set(basePos.x, targetY, basePos.z);
          } else if (axis === 2) { // Z axis - from center to back wall through dot
            const totalDistance = center.z - (-cubeSize/2);
            const targetZ = center.z - t * totalDistance;
            child.position.set(basePos.x, basePos.y, targetZ);
          }
          
          // Fade in at start, fade out at end
          if (t < 0.1) {
            child.material.opacity = 0.6 * (t / 0.1);
          } else if (t > 0.9) {
            child.material.opacity = 0.6 * ((1 - t) / 0.1);
          } else {
            child.material.opacity = 0.6;
          }
        }
        
        // Animate ripples at wall impact
        if (child.userData.isRipple) {
          const axis = child.userData.axis;
          const t = (time + dot.id * 0.5 + axis * 2) % 1;
          
          // Trigger ripple when pulse hits wall (t near 1.0)
          if (t > 0.92) {
            const rippleProgress = (t - 0.92) / 0.08; // 0 to 1 over last 8%
            const scale = 1 + rippleProgress * 3; // Expand 1x to 4x
            child.scale.set(scale, scale, 1);
            child.material.opacity = 0.5 * (1 - rippleProgress); // Fade out
            
            // Position ripple on the wall
            if (axis === 0) { // Left wall
              child.position.set(-cubeSize/2, basePos.y, basePos.z);
              child.rotation.y = Math.PI / 2;
            } else if (axis === 1) { // Bottom wall
              child.position.set(basePos.x, -cubeSize/2, basePos.z);
              child.rotation.x = Math.PI / 2;
            } else if (axis === 2) { // Back wall
              child.position.set(basePos.x, basePos.y, -cubeSize/2);
              child.rotation.y = 0;
            }
          } else {
            child.material.opacity = 0; // Hide ripple when not impacting
          }
        }
      });
    }
  });
  
  renderer.render(scene, camera);
}

// Use WebXR render loop
renderer.setAnimationLoop(animate);

// --- BUTTONS ---
document.getElementById('download').addEventListener('click', () => {
  const link = document.createElement('a');
  link.download = 'spectrograph.png';
  link.href = spectroCanvas.toDataURL();
  link.click();
});

document.getElementById('clear').addEventListener('click', () => {
  while (dots.length > 0) {
    destroyDot(dots[0]);
  }
});

document.getElementById('reset-position').addEventListener('click', () => {
  // Reset cube rotation to initial state
  cubeGroup.rotation.x = 0;
  cubeGroup.rotation.y = Math.PI / 12; // Initial Y rotation (15 degrees)
  cubeGroup.rotation.z = 0;
});
