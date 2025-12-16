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
        if (hoverMarker) {
          hoverMarker.visible = false;
        }
        renderer.xr.getSession().end();
      } else {
        navigator.xr.requestSession('immersive-vr', {
          requiredFeatures: ['local-floor'],
          optionalFeatures: ['hand-tracking']
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
  line.visible = false; // Hide until we know if this input source is a controller
  controller.add(line);

  controller.addEventListener('connected', (event) => {
    controller.userData.inputSource = event.data;
    if (line) {
      const hasHand = event.data && event.data.hand;
      line.visible = !hasHand;
    }
  });

  controller.addEventListener('disconnected', () => {
    controller.userData.inputSource = null;
    if (line) {
      line.visible = false;
    }
  });

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
let lastButtonClickTime = 0;
const BUTTON_CLICK_COOLDOWN = 500; // ms to prevent double-clicks
const hands = [];
const handModels = [];

// Hand tracking setup
function setupHand(index) {
  const hand = renderer.xr.getHand(index);
  hand.addEventListener('pinchstart', onHandPinchStart);
  hand.addEventListener('pinchend', onHandPinchEnd);
  scene.add(hand);
  hands[index] = hand;
  
  // Store references to joint spheres - they'll be created dynamically when hand connects
  handModels[index] = {
    spheres: {},
    pointerRay: null
  };
  
  return hand;
}

setupHand(0);
setupHand(1);

// --- BUILD TIMBRE CUBE ---
const cubeGroup = new THREE.Group();
cubeGroup.rotation.y = Math.PI / 12; // Rotate counter-clockwise about 15 degrees
scene.add(cubeGroup);

const cubeSize = 4;
const purePoint = new THREE.Vector3(-cubeSize / 2, -cubeSize / 2, -cubeSize / 2); // (0,0,0) timbre origin
const faces = [];
let hoverLines = null;
let hoverMarker = null;
let vrHoverLinesLeft = null;
let vrHoverLinesRight = null;
let loadedModel = null;
let invisibleCube = null;
let spectralFluxLabel = null;
const tempVecA = new THREE.Vector3();
const tempVecB = new THREE.Vector3();
const tempQuatA = new THREE.Quaternion();
const NEG_Z = new THREE.Vector3(0, 0, -1);

// Hover marker that previews dot placement
const hoverMarkerGeometry = new THREE.BoxGeometry(0.2, 0.2, 0.2);
const hoverMarkerMaterial = new THREE.MeshBasicMaterial({
  color: 0xffff00,
  transparent: true,
  opacity: 0.35,
  depthTest: false,
  depthWrite: false
});
hoverMarker = new THREE.Mesh(hoverMarkerGeometry, hoverMarkerMaterial);
hoverMarker.visible = false;
hoverMarker.renderOrder = 20;
cubeGroup.add(hoverMarker);

// Convert a cube-local point to normalized timbre parameters (0-1 range).
function normalizeTimbreCoords(point) {
  const halfSize = cubeSize / 2;
  const normalizedX = (point.x + halfSize) / cubeSize;
  const normalizedY = (point.y + halfSize) / cubeSize;
  const normalizedZ = (point.z + halfSize) / cubeSize;

  return {
    x: THREE.MathUtils.clamp(normalizedX, 0, 1),
    y: THREE.MathUtils.clamp(normalizedY, 0, 1),
    z: THREE.MathUtils.clamp(normalizedZ, 0, 1)
  };
}

// Create an invisible cube that matches the volume for raycasting
const invisibleGeometry = new THREE.BoxGeometry(cubeSize, cubeSize, cubeSize);
const invisibleMaterial = new THREE.MeshBasicMaterial({ 
  transparent: true, 
  opacity: 0,
  side: THREE.DoubleSide // Detect from both inside and outside
});
invisibleCube = new THREE.Mesh(invisibleGeometry, invisibleMaterial);
invisibleCube.userData.isInvisibleBoundingBox = true;
cubeGroup.add(invisibleCube);

// Add visible wireframe edges to show cube bounds
const wireframeGeometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(cubeSize, cubeSize, cubeSize));
const wireframeMaterial = new THREE.LineBasicMaterial({ color: 0x00ff88, opacity: 0.3, transparent: true });
const wireframeBox = new THREE.LineSegments(wireframeGeometry, wireframeMaterial);
cubeGroup.add(wireframeBox);

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
  if (Math.abs(normalVector.z + 1) < 0.001) {
    material.opacity = 0.04;
    material.transmission = 0;
    material.depthWrite = false;
  } else if (Math.abs(normalVector.y + 1) < 0.001) {
    material.opacity = 0.18;
    material.transmission = 0.18;
    material.depthWrite = false;
  }
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

  if (!SHOW_FRONT_BOTTOM_PANES && (normalVector.z === -1 || normalVector.y === -1)) {
    face.visible = false;
    edges.visible = false;
  }
  
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
    canvas.height = 2048;
    const ctx = canvas.getContext('2d');
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw text vertically (one letter per line)
    ctx.font = 'bold 85px Arial';
    ctx.fillStyle = '#00ff88';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    ctx.shadowColor = '#00ff88';
    ctx.shadowBlur = 30;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    
    // Calculate spacing for vertical text
    const letters = text.split('');
    const letterSpacing = 110;
    const totalHeight = letters.length * letterSpacing;
    const startY = (canvas.height - totalHeight) / 2 + letterSpacing / 2;
    
    letters.forEach((letter, i) => {
      ctx.fillText(letter, canvas.width / 2, startY + i * letterSpacing);
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
  
  // Left plane - Spectral Centroid label with two versions (front and back view)
  // Front view label: "Spectral Centroid"
  const brightnessLabelFront = createVerticalLabelCanvas('Spectral Centroid');
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
  
  // Back view label: "Spectral Centroid"
  const brightnessLabelBack = createVerticalLabelCanvas('Spectral Centroid');
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
  
  // Bottom plane - Noisyness label with two versions (top and bottom view)
  // Top view label: "Noisyness"
  const transientsLabelTop = createLargeLabelCanvas('Noisyness');
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
  
  // Bottom view label: "Noisyness"
  const transientsLabelBottom = createLargeLabelCanvas('Noisyness');
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
  
  // Back/Transients face - "Inharmonicity" with two labels (front and back)
  // Front-facing label: "Inharmonicity"
  const backLabelFront = createLargeLabelCanvas('Inharmonicity');
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
  
  // Back-facing label: "Inharmonicity"
  const backLabelBack = createLargeLabelCanvas('Inharmonicity');
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

const masterBus = new Tone.Gain(0.6);
masterBus.connect(mixBus);

// Small-room convolution reverb (procedural IR for natural short space)
function createSmallRoomIR(seconds = 0.25, decay = 3.0) {
  const context = Tone.getContext().rawContext;
  const rate = context.sampleRate;
  const length = Math.max(1, Math.floor(rate * seconds));
  const impulse = context.createBuffer(2, length, rate);
  for (let ch = 0; ch < impulse.numberOfChannels; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const t = i / length;
      // Exponential decay of noise for room-like tail
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
    }
  }
  return impulse;
}

const roomIR = createSmallRoomIR(0.28, 3.4);
const reverb = new Tone.Convolver(roomIR);
reverb.normalize = true;
reverb.connect(mixBus);

let isPlaying = true; // Global play/pause state

// Subtle correlated random-walk jitter to add natural variation while keeping coherence
const jitterState = {
  shared: 0,
  detune: 0
};

function tickJitter() {
  // Shared jitter for cutoff/noise
  jitterState.shared = THREE.MathUtils.clamp(
    jitterState.shared + (Math.random() - 0.5) * 14,
    -80,
    80
  );

  // Slow detune jitter (cents) for inharmonic companion
  jitterState.detune = THREE.MathUtils.clamp(
    jitterState.detune + (Math.random() - 0.5) * 2.5,
    -8,
    8
  );
}

setInterval(tickJitter, 480);

const SHOW_FRONT_BOTTOM_PANES = true;

const clarinetBaseNote = 'G4';

let audioReadyPromise = null;
async function ensureAudioStarted() {
  if (Tone.context.state === 'running') {
    return;
  }
  if (!audioReadyPromise) {
    audioReadyPromise = Tone.start()
      .catch(err => {
        console.error('Tone.js failed to start audio context:', err);
        throw err;
      });
  }
  await audioReadyPromise;
}

// Track playing dots
const dots = [];
let dotIdCounter = 0;

// Preload the clarinet sample for faster voice creation
let clarinetBuffer = null;
const clarinetSamplePath = 'assets/sounds/Clarinet_G.wav';

async function loadClarinetSample() {
  if (clarinetBuffer) return clarinetBuffer;
  clarinetBuffer = await Tone.Buffer.fromUrl(clarinetSamplePath);
  console.log('Clarinet sample loaded');
  return clarinetBuffer;
}

// Start loading immediately
loadClarinetSample().catch(err => console.error('Failed to load clarinet sample:', err));

function createDotVoice(dot) {
  const output = new Tone.Gain(0.7);
  output.connect(masterBus);

  const reverbSend = new Tone.Gain(0.16);
  output.connect(reverbSend);
  reverbSend.connect(reverb);

  // --- SAMPLE PLAYER (replaces oscillators) ---
  // The clarinet sample is the pure base sound at position (0,0,0)
  const samplePlayer = new Tone.Player({
    url: clarinetBuffer || clarinetSamplePath,
    loop: true,
    fadeIn: 0.05,
    fadeOut: 0.05
  });
  const sampleGain = new Tone.Gain(0.9);
  samplePlayer.connect(sampleGain);

  // --- PITCH SHIFT for inharmonicity effect ---
  // Slight pitch shifting creates roughness/beating when mixed with original
  const pitchShift = new Tone.PitchShift({
    pitch: 0,
    windowSize: 0.1,
    delayTime: 0,
    feedback: 0
  });
  const pitchShiftGain = new Tone.Gain(0); // Controlled by X axis
  samplePlayer.connect(pitchShift);
  pitchShift.connect(pitchShiftGain);

  // --- NOISE for breath/noisiness ---
  const noiseSource = new Tone.Noise('pink');
  const noiseFilter = new Tone.Filter({
    type: 'bandpass',
    frequency: 2000,
    Q: 0.8
  });
  const noiseGain = new Tone.Gain(0.05); // Slight breath
  noiseSource.connect(noiseFilter);
  noiseFilter.connect(noiseGain);

  // Breath transient for a natural attack
  const breathNoise = new Tone.Noise('white');
  const breathFilter = new Tone.Filter({
    type: 'bandpass',
    frequency: 1400,
    Q: 1.4
  });
  const breathGain = new Tone.Gain(0);
  const breathEnv = new Tone.Envelope({
    attack: 0.01,
    decay: 0.16,
    sustain: 0,
    release: 0.08
  });
  breathNoise.connect(breathFilter);
  breathFilter.connect(breathGain);
  breathEnv.connect(breathGain.gain);

  // --- FILTER for spectral centroid ---
  const centroidFilter = new Tone.Filter({
    type: 'lowpass',
    frequency: 3500,
    Q: 0.5,
    rolloff: -24
  });

  // High shelf EQ
  const highShelf = new Tone.EQ3({
    low: 1,
    mid: 0,
    high: -1.0,
    lowFrequency: 280,
    highFrequency: 2400
  });

  // Gentle body resonance for naturalness
  const bodyBell = new Tone.Filter({
    type: 'peaking',
    frequency: 1850,
    Q: 1.1,
    gain: 2
  });

  // Soft saturation to glue components
  const saturator = new Tone.Distortion(0.025);
  saturator.oversample = '2x';

  // Main amplitude envelope
  const ampEnv = new Tone.AmplitudeEnvelope({
    attack: 0.16,
    decay: 0.25,
    sustain: 0.88,
    release: 1.2
  });

  // Signal routing: sample/noise -> filter -> EQ -> envelope -> output
  sampleGain.connect(centroidFilter);
  pitchShiftGain.connect(centroidFilter);
  noiseGain.connect(centroidFilter);
  breathGain.connect(centroidFilter);
  centroidFilter.connect(highShelf);
  highShelf.connect(bodyBell);
  bodyBell.connect(saturator);
  saturator.connect(ampEnv);
  ampEnv.connect(output);

  // Start sample and noise
  samplePlayer.start();
  noiseSource.start();
  breathNoise.start();

  // Trigger envelope
  ampEnv.triggerAttack();

  const voice = {
    output,
    reverbSend,
    ampEnv,
    samplePlayer,
    sampleGain,
    pitchShift,
    pitchShiftGain,
    noiseSource,
    noiseFilter,
    noiseGain,
    breathNoise,
    breathFilter,
    breathGain,
    breathEnv,
    centroidFilter,
    highShelf,
    bodyBell,
    saturator,
    disposing: false
  };
  dot.voice = voice;

  updateDotAudio(dot);
}

function updateDotAudio(dot) {
  if (!dot.voice || dot.voice.disposing) {
    return;
  }

  const voice = dot.voice;
  
  // Get normalized parameters (0-1 range)
  const rawX = THREE.MathUtils.clamp(dot.x, 0, 1);
  const rawY = THREE.MathUtils.clamp(dot.y, 0, 1);
  const rawZ = THREE.MathUtils.clamp(dot.z, 0, 1);
  
  // One-sided mappings: 0 = pure/clean/dark, 1 = rough/noisy/bright
  const inharmonicity = rawX;      // 0 to 1
  const spectralCentroid = rawY;   // 0 (dark) to 1 (bright)
  const noisiness = rawZ;          // 0 (clean) to 1 (noisy)

  // === INHARMONICITY (X axis) ===
  // At 0: pure clarinet sample only
  // At 1: mix in pitch-shifted version for roughness/beating
  const sampleLevel = THREE.MathUtils.lerp(0.97, 0.6, inharmonicity * 0.8);
  voice.sampleGain.gain.linearRampTo(inharmonicity < 0.02
    ? 0.99
    : sampleLevel, 0.12);
  
  const pitchShiftLevel = THREE.MathUtils.lerp(0, 0.5, inharmonicity);
  voice.pitchShiftGain.gain.linearRampTo(inharmonicity < 0.02
    ? 0
    : pitchShiftLevel, 0.12);

  // Pitch shift amount for roughness (slight detuning creates beating)
  const detuneBaseCents = THREE.MathUtils.lerp(0, 0.25, inharmonicity); // up to ~quarter semitone
  const detuneJitterCents = (jitterState.detune / 100) * inharmonicity; // slow jitter, scaled by x
  voice.pitchShift.pitch = detuneBaseCents + detuneJitterCents;

  // === SPECTRAL CENTROID (Y axis) ===
  const minCutoff = 700;
  const maxCutoff = 13500;

  // Perceptual-ish curve (pow) instead of strictly linear
  const yPerceptual = Math.pow(spectralCentroid, 0.6);
  const cutoffBase = THREE.MathUtils.lerp(minCutoff, maxCutoff, yPerceptual);

  const cutoffFreq = THREE.MathUtils.clamp(cutoffBase + jitterState.shared, 500, 14500);
  voice.centroidFilter.frequency.linearRampTo(cutoffFreq, 0.1);

  const filterQ = THREE.MathUtils.clamp(0.8 + spectralCentroid * 1.1, 0.3, 1.9);
  voice.centroidFilter.Q.linearRampTo(filterQ, 0.1);

  const highBoost = (spectralCentroid - 0.5) * 8; // softer and centered tilt
  voice.highShelf.high.linearRampTo(highBoost, 0.1);

  // Keep noise aligned with the same spectral tilt for one-source perception
  const noiseFreqBase = THREE.MathUtils.lerp(600, 8000, yPerceptual);
  const noiseFreq = THREE.MathUtils.clamp(noiseFreqBase + jitterState.shared * 0.35, 400, 9000);
  voice.noiseFilter.frequency.linearRampTo(noiseFreq, 0.1);

  // === NOISINESS (Z axis) ===
  const noiseLevel = THREE.MathUtils.clamp(0.01 + 0.45 * Math.pow(noisiness, 0.8) + jitterState.shared / 9000, 0.001, 0.55);
  voice.noiseGain.gain.linearRampTo(noiseLevel, 0.1);
  
  const noiseQ = THREE.MathUtils.clamp(1.2 - noisiness * 0.8, 0.35, 2.0);
  voice.noiseFilter.Q.linearRampTo(noiseQ, 0.1);

  // === CROSS-PARAMETER INTERACTIONS ===
  const reverbAmount = Math.min(0.28, 0.15 + spectralCentroid * 0.08 + noisiness * 0.10);
  voice.reverbSend.gain.linearRampTo(reverbAmount, 0.18);

  // Update readouts (show 0-1 values for display)
  updateDescriptorReadouts({
    centroid: rawY,
    noisiness: rawZ,
    inharm: rawX
  });
}

function disposeDotVoice(dot, immediate = false) {
  if (!dot.voice || dot.voice.disposing) {
    return;
  }

  const voice = dot.voice;
  voice.disposing = true;
  dot.voice = null;

  if (!immediate) {
    voice.ampEnv.triggerRelease();
  }
  const releaseTail = immediate ? 0 : voice.ampEnv.release + 0.2;

  setTimeout(() => {
    if (voice.samplePlayer) {
      voice.samplePlayer.stop();
      voice.samplePlayer.dispose();
    }
    if (voice.sampleGain) voice.sampleGain.dispose();
    if (voice.pitchShift) voice.pitchShift.dispose();
    if (voice.pitchShiftGain) voice.pitchShiftGain.dispose();

    if (voice.noiseSource) {
      voice.noiseSource.stop();
      voice.noiseSource.dispose();
    }
    if (voice.noiseFilter) voice.noiseFilter.dispose();
    if (voice.noiseGain) voice.noiseGain.dispose();

    if (voice.breathNoise) {
      voice.breathNoise.stop();
      voice.breathNoise.dispose();
    }
    if (voice.breathFilter) voice.breathFilter.dispose();
    if (voice.breathGain) voice.breathGain.dispose();
    if (voice.breathEnv) voice.breathEnv.dispose();

    if (voice.centroidFilter) voice.centroidFilter.dispose();
    if (voice.highShelf) voice.highShelf.dispose();
    if (voice.bodyBell) voice.bodyBell.dispose();
    if (voice.saturator) voice.saturator.dispose();

    voice.ampEnv.dispose();
    voice.output.dispose();
    voice.reverbSend.dispose();
  }, releaseTail * 1000);
}

function restartDotVoice(dot) {
  // Recreate the voice to re-align phases and apply current parameters
  if (dot.voice) {
    disposeDotVoice(dot, true);
  }
  createDotVoice(dot);
  updateDotAudio(dot);

  if (dot.voice && dot.voice.breathEnv) {
    dot.voice.breathEnv.triggerAttackRelease(0.22);
  }
}

async function setPlaying(state) {
  if (state === isPlaying) return;
  isPlaying = state;

  const btn = document.getElementById('play-pause');
  if (btn) {
    btn.textContent = isPlaying ? 'Pause' : 'Play';
  }

  if (!isPlaying) {
    masterBus.gain.rampTo(0, 0.05);
    dots.forEach((dot) => {
      if (dot.voice && !dot.voice.disposing) {
        dot.voice.output.gain.rampTo(0, 0.05);
        dot.voice.ampEnv.triggerRelease();
      }
    });
    return;
  }

  await ensureAudioStarted();
  masterBus.gain.rampTo(0.6, 0.05);
  dots.forEach((dot) => restartDotVoice(dot));
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
  if (dot.pickHelper) {
    if (dot.pickHelper.geometry) dot.pickHelper.geometry.dispose();
    if (dot.pickHelper.material) dot.pickHelper.material.dispose();
    cubeGroup.remove(dot.pickHelper);
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
  if (dots.length === 0) {
    updateDescriptorReadouts(null);
  }
}

// --- RAYCASTER FOR INTERACTION ---
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let draggedDot = null;
let draggingHandle = false;
let lastMouseX = 0;
let lastMouseY = 0;

function getIntersectionPoint(raycaster, isDragging = false) {
  cubeGroup.updateWorldMatrix(true, false);
  const inverseMatrix = new THREE.Matrix4().copy(cubeGroup.matrixWorld).invert();
  const localRay = raycaster.ray.clone().applyMatrix4(inverseMatrix);

  const halfSize = cubeSize / 2;
  const box = new THREE.Box3(
    new THREE.Vector3(-halfSize, -halfSize, -halfSize),
    new THREE.Vector3(halfSize, halfSize, halfSize)
  );

  // When dragging an existing dot, keep its current depth and move in full 3D using screen-space depth preservation.
  if (isDragging && draggedDot) {
    const dotWorld = new THREE.Vector3();
    draggedDot.mesh.getWorldPosition(dotWorld);
    const dotNdc = dotWorld.clone().project(camera);

    const targetNdc = new THREE.Vector3(mouse.x, mouse.y, dotNdc.z);
    const targetWorld = targetNdc.clone().unproject(camera);
    const localPoint = cubeGroup.worldToLocal(targetWorld.clone());

    localPoint.x = Math.max(-halfSize, Math.min(halfSize, localPoint.x));
    localPoint.y = Math.max(-halfSize, Math.min(halfSize, localPoint.y));
    localPoint.z = Math.max(-halfSize, Math.min(halfSize, localPoint.z));
    return localPoint;
  }

  let result = null;

  // First try direct ray-box intersection in cube-local space
  const hitPoint = new THREE.Vector3();
  const hit = localRay.intersectBox(box, hitPoint);
  if (hit) {
    result = hitPoint;
  } else {
    // If box miss, try intersecting the invisible cube mesh in world space and convert to local.
    const boxIntersects = invisibleCube ? raycaster.intersectObject(invisibleCube) : [];
    if (boxIntersects.length > 0) {
      const worldPoint = boxIntersects[0].point.clone();
      result = cubeGroup.worldToLocal(worldPoint);
    }
  }

  if (!result && isDragging) {
    // Fallback: clamp along ray direction so the marker stays reachable.
    if (!result) {
      const samplePoint = new THREE.Vector3();
      localRay.at(10, samplePoint);
      result = box.clampPoint(samplePoint, new THREE.Vector3());
    }
  }

  if (!result) return null;

  // Clamp final point to cube bounds to prevent wandering outside the box.
  result.x = Math.max(-halfSize, Math.min(halfSize, result.x));
  result.y = Math.max(-halfSize, Math.min(halfSize, result.y));
  result.z = Math.max(-halfSize, Math.min(halfSize, result.z));

  return result;
}

function addDotAtPoint(point) {
  // Maintain a single marker by removing extras if they exist
  while (dots.length > 1) {
    destroyDot(dots[dots.length - 1]);
  }

  let dot = dots[0];

  if (!dot) {
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
    dotMesh.castShadow = true;
    dotMesh.receiveShadow = true;
    dotMesh.renderOrder = 0; // Render cubes first
    cubeGroup.add(dotMesh);

    // Create a shadow plane that projects straight down to the bottom wall
    const shadowGeometry = new THREE.PlaneGeometry(0.2, 0.2);
    const shadowMaterial = new THREE.ShadowMaterial({ opacity: 0 });
    const shadowPlane = new THREE.Mesh(shadowGeometry, shadowMaterial);
    shadowPlane.receiveShadow = true;
    shadowPlane.rotation.x = Math.PI / 2; // Rotate to be horizontal on the bottom
    cubeGroup.add(shadowPlane);

    // Invisible (but pickable) helper to make selection easier
    const pickGeom = new THREE.SphereGeometry(0.7, 16, 16); // larger invisible hit target for easy picking
    const pickMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthWrite: false
    });
    const pickMesh = new THREE.Mesh(pickGeom, pickMat);
    pickMesh.renderOrder = 0;
    cubeGroup.add(pickMesh);

    dot = {
      mesh: dotMesh,
      shadow: shadowPlane,
      crosshairs: null,
      x: 0,
      y: 0,
      z: 0,
      id: dotIdCounter++,
      pickHelper: pickMesh
    };
    dots.push(dot);
    createDotVoice(dot);
  }

  // Update position and related visuals
  dot.mesh.position.copy(point);
  dot.mesh.visible = true;
  dot.shadow.position.set(point.x, -cubeSize / 2, point.z);
  dot.shadow.visible = true;
  if (dot.pickHelper) {
    dot.pickHelper.position.copy(point);
  }
  if (dot.pickHelper) {
    dot.pickHelper.position.copy(point);
  }

  if (dot.crosshairs) {
    cubeGroup.remove(dot.crosshairs);
    dot.crosshairs.traverse(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
  }
  dot.crosshairs = createHoverLines(point, true);
  cubeGroup.add(dot.crosshairs);

  // Map 3D position to timbre parameters (brightness increases downward)
  const normalized = normalizeTimbreCoords(point);
  dot.x = normalized.x;
  dot.y = normalized.y;
  dot.z = normalized.z;

  updateDotAudio(dot);
  if (isPlaying && dot.voice) {
    dot.voice.ampEnv.triggerAttack();
  } else if (dot.voice) {
    dot.voice.output.gain.rampTo(0, 0.01);
  }

  if (hoverMarker) {
    hoverMarker.visible = false;
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

  const pickerMeshes = dots.map(d => d.pickHelper || d.mesh).filter(Boolean);
  const intersects = raycaster.intersectObjects(pickerMeshes);
  
  if (intersects.length > 0) {
    const clickedMesh = intersects[0].object;
    draggedDot = dots.find(d => d.pickHelper === clickedMesh || d.mesh === clickedMesh);
    
    if (draggedDot) {
      event.preventDefault();
    }
  } else if (dots.length > 0) {
    // Screen-space fallback: pick the nearest dot if the cursor is close in NDC.
    const ndc = new THREE.Vector2(mouse.x, mouse.y);
    let bestDot = null;
    let bestDist = Infinity;
    dots.forEach(d => {
      const wp = new THREE.Vector3();
      d.mesh.getWorldPosition(wp);
      wp.project(camera);
      const dist = ndc.distanceTo(new THREE.Vector2(wp.x, wp.y));
      if (dist < bestDist) {
        bestDist = dist;
        bestDot = d;
      }
    });
    if (bestDot && bestDist < 0.2) { // ~20% of view; very forgiving pick radius
      draggedDot = bestDot;
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
    raycaster.setFromCamera(mouse, camera);
    const intersectPoint = getIntersectionPoint(raycaster, true); // isDragging = true

    if (!intersectPoint) {
      return; // Keep dot at last valid location if ray misses cube
    }

    draggedDot.mesh.position.copy(intersectPoint);
    if (draggedDot.pickHelper) {
      draggedDot.pickHelper.position.copy(intersectPoint);
    }

    // Update shadow position to follow the dot
    draggedDot.shadow.position.set(intersectPoint.x, -cubeSize/2, intersectPoint.z);

    // Update crosshairs position to follow the dot
    if (draggedDot.crosshairs) {
      cubeGroup.remove(draggedDot.crosshairs);
      draggedDot.crosshairs = createHoverLines(intersectPoint, true);
      cubeGroup.add(draggedDot.crosshairs);
    }

    // Update all 3D coordinates based on position in volume
    const draggedNormalized = normalizeTimbreCoords(intersectPoint);
    draggedDot.x = draggedNormalized.x;
    draggedDot.y = draggedNormalized.y;
    draggedDot.z = draggedNormalized.z;

    updateDotAudio(draggedDot);
    return; // Skip hover logic while dragging
  }
  
}

function onMouseUp(event) {
  draggedDot = null;
  draggingHandle = false;
}

// Scroll wheel to adjust depth (Z axis) of the marker
function onMouseWheel(event) {
  if (dots.length === 0) return;
  
  const dot = dots[0];
  if (!dot) return;
  
  event.preventDefault();
  
  const halfSize = cubeSize / 2;
  const step = cubeSize * 0.05; // 5% of cube size per scroll tick
  const delta = event.deltaY > 0 ? -step : step; // Scroll up = forward, down = back
  
  // Update Z position (depth)
  const newZ = Math.max(-halfSize, Math.min(halfSize, dot.mesh.position.z + delta));
  dot.mesh.position.z = newZ;
  
  // Update shadow and crosshairs
  dot.shadow.position.set(dot.mesh.position.x, -halfSize, newZ);
  if (dot.pickHelper) {
    dot.pickHelper.position.set(dot.mesh.position.x, dot.mesh.position.y, newZ);
  }
  if (dot.crosshairs) {
    cubeGroup.remove(dot.crosshairs);
    dot.crosshairs = createHoverLines(dot.mesh.position, true);
    cubeGroup.add(dot.crosshairs);
  }
  
  // Update normalized coords
  const normalized = normalizeTimbreCoords(dot.mesh.position);
  dot.x = normalized.x;
  dot.y = normalized.y;
  dot.z = normalized.z;
  
  updateDotAudio(dot);
}

// Keyboard controls for fine positioning
function onKeyDown(event) {
  if (dots.length === 0) return;
  
  const dot = dots[0];
  if (!dot) return;
  
  const halfSize = cubeSize / 2;
  const step = event.shiftKey ? cubeSize * 0.1 : cubeSize * 0.03; // Shift = bigger steps
  let moved = false;
  
  switch (event.key) {
    case 'ArrowLeft':
      dot.mesh.position.x = Math.max(-halfSize, dot.mesh.position.x - step);
      moved = true;
      break;
    case 'ArrowRight':
      dot.mesh.position.x = Math.min(halfSize, dot.mesh.position.x + step);
      moved = true;
      break;
    case 'ArrowUp':
      if (event.ctrlKey || event.metaKey) {
        // Ctrl+Up = move forward (Z)
        dot.mesh.position.z = Math.min(halfSize, dot.mesh.position.z + step);
      } else {
        // Up = move up (Y)
        dot.mesh.position.y = Math.min(halfSize, dot.mesh.position.y + step);
      }
      if (dot.pickHelper) dot.pickHelper.position.copy(dot.mesh.position);
      moved = true;
      break;
    case 'ArrowDown':
      if (event.ctrlKey || event.metaKey) {
        // Ctrl+Down = move backward (Z)
        dot.mesh.position.z = Math.max(-halfSize, dot.mesh.position.z - step);
      } else {
        // Down = move down (Y)
        dot.mesh.position.y = Math.max(-halfSize, dot.mesh.position.y - step);
      }
      if (dot.pickHelper) dot.pickHelper.position.copy(dot.mesh.position);
      moved = true;
      break;
    case 'w': case 'W':
      dot.mesh.position.z = Math.min(halfSize, dot.mesh.position.z + step);
      if (dot.pickHelper) dot.pickHelper.position.copy(dot.mesh.position);
      moved = true;
      break;
    case 's': case 'S':
      dot.mesh.position.z = Math.max(-halfSize, dot.mesh.position.z - step);
      if (dot.pickHelper) dot.pickHelper.position.copy(dot.mesh.position);
      moved = true;
      break;
    case 'a': case 'A':
      dot.mesh.position.x = Math.max(-halfSize, dot.mesh.position.x - step);
      moved = true;
      break;
    case 'd': case 'D':
      dot.mesh.position.x = Math.min(halfSize, dot.mesh.position.x + step);
      moved = true;
      break;
    case 'q': case 'Q':
      dot.mesh.position.y = Math.min(halfSize, dot.mesh.position.y + step);
      moved = true;
      break;
    case 'e': case 'E':
      dot.mesh.position.y = Math.max(-halfSize, dot.mesh.position.y - step);
      moved = true;
      break;
    // Number keys for corner presets
    case '1': // Front-bottom-left
      dot.mesh.position.set(-halfSize * 0.98, -halfSize * 0.98, halfSize * 0.98);
      moved = true;
      break;
    case '2': // Front-bottom-right
      dot.mesh.position.set(halfSize * 0.98, -halfSize * 0.98, halfSize * 0.98);
      moved = true;
      break;
    case '3': // Front-top-left
      dot.mesh.position.set(-halfSize * 0.98, halfSize * 0.98, halfSize * 0.98);
      moved = true;
      break;
    case '4': // Front-top-right
      dot.mesh.position.set(halfSize * 0.98, halfSize * 0.98, halfSize * 0.98);
      moved = true;
      break;
    case '5': // Back-bottom-left
      dot.mesh.position.set(-halfSize * 0.98, -halfSize * 0.98, -halfSize * 0.98);
      moved = true;
      break;
    case '6': // Back-bottom-right
      dot.mesh.position.set(halfSize * 0.98, -halfSize * 0.98, -halfSize * 0.98);
      moved = true;
      break;
    case '7': // Back-top-left
      dot.mesh.position.set(-halfSize * 0.98, halfSize * 0.98, -halfSize * 0.98);
      moved = true;
      break;
    case '8': // Back-top-right
      dot.mesh.position.set(halfSize * 0.98, halfSize * 0.98, -halfSize * 0.98);
      moved = true;
      break;
    case '0': // Center
      dot.mesh.position.set(0, 0, 0);
      moved = true;
      break;
  }
  
  if (moved) {
    event.preventDefault();
    
    // Update shadow and crosshairs
    dot.shadow.position.set(dot.mesh.position.x, -halfSize, dot.mesh.position.z);
    if (dot.crosshairs) {
      cubeGroup.remove(dot.crosshairs);
      dot.crosshairs = createHoverLines(dot.mesh.position, true);
      cubeGroup.add(dot.crosshairs);
    }
    
    // Update normalized coords
    const normalized = normalizeTimbreCoords(dot.mesh.position);
    dot.x = normalized.x;
    dot.y = normalized.y;
    dot.z = normalized.z;
    
    updateDotAudio(dot);
  }
}

function createHoverLines(point, isPermanent = false) {
  const group = new THREE.Group();
  const lineColor = 0xffff00;
  const opacity = isPermanent ? 0.4 : 0.8; // More transparent for permanent crosshairs
  const extension = 0.05; // Extend lines slightly past walls

  const materialConfig = {
    color: lineColor,
    transparent: true,
    opacity: opacity,
    depthTest: false,
    depthWrite: false
  };
  
  // Create three simple lines from dot to each wall
  // Line to left wall (X = -cubeSize/2)
  const toLeftWall = new THREE.BufferGeometry();
  toLeftWall.setAttribute('position', new THREE.BufferAttribute(
    new Float32Array([
      point.x, point.y, point.z,
      -cubeSize/2 - extension, point.y, point.z
    ]), 3));
  const leftLine = new THREE.Line(toLeftWall, new THREE.LineBasicMaterial(materialConfig));
  leftLine.renderOrder = 25;
  group.add(leftLine);
  
  // Line to bottom wall (Y = -cubeSize/2)
  const toBottomWall = new THREE.BufferGeometry();
  toBottomWall.setAttribute('position', new THREE.BufferAttribute(
    new Float32Array([
      point.x, point.y, point.z,
      point.x, -cubeSize/2 - extension, point.z
    ]), 3));
  const bottomLine = new THREE.Line(toBottomWall, new THREE.LineBasicMaterial(materialConfig));
  bottomLine.renderOrder = 25;
  group.add(bottomLine);
  
  // Line to back wall (Z = -cubeSize/2)
  const toBackWall = new THREE.BufferGeometry();
  toBackWall.setAttribute('position', new THREE.BufferAttribute(
    new Float32Array([
      point.x, point.y, point.z,
      point.x, point.y, -cubeSize/2 - extension
    ]), 3));
  const backLine = new THREE.Line(toBackWall, new THREE.LineBasicMaterial(materialConfig));
  backLine.renderOrder = 25;
  group.add(backLine);

  group.userData.isPermanent = isPermanent;
  group.userData.basePosition = point.clone();

  return group;
}

let vrDraggedInfo = {
  dot: null,
  handle: null,
  source: null, // Will be the controller or hand object
  isRotating: false,
  isDragging: false
};
// --- Unified Event Handlers ---

// This single function will now handle the start of any primary VR action.
async function handleVRInputStart(event) {
  await ensureAudioStarted();

  const source = event.target;
  const raycaster = getVRRaycaster(source);
  if (!raycaster) return;

  // 1. Check for UI button clicks (highest priority)
  if (vrUIPanel) {
    const buttons = vrUIPanel.children;
    const uiIntersects = raycaster.intersectObjects(buttons, false);
    if (uiIntersects.length > 0) {
      const now = Date.now();
      if (now - lastButtonClickTime < BUTTON_CLICK_COOLDOWN) return;
      lastButtonClickTime = now;
      
      const button = uiIntersects[0].object;
      handleVRUIClick(button); // Pass the button mesh directly
      return; // Stop further processing
    }
  }

  // 2. Check for rotation handle grab
  const handleIntersects = raycaster.intersectObjects(handleBalls);
  if (handleIntersects.length > 0) {
    vrDraggedInfo = {
      handle: handleIntersects[0].object,
      source: source,
      isRotating: true,
      isDragging: false,
      dot: null
    };
    if (source.userData.inputSource && source.userData.inputSource.hand) {
      source.userData.lastHandPos = new THREE.Vector3().setFromMatrixPosition(source.joints['index-finger-tip'].matrixWorld);
    } else {
      source.userData.lastControllerPos = new THREE.Vector3().setFromMatrixPosition(source.matrixWorld);
    }
    return; // Stop further processing
  }

  // 3. Check for existing dot drag
  const dotMeshes = dots.map(d => d.mesh);
  const intersects = raycaster.intersectObjects(dotMeshes);
  if (intersects.length > 0) {
    vrDraggedInfo = {
      dot: dots.find(d => d.mesh === intersects[0].object),
      source: source,
      isDragging: true,
      isRotating: false,
      handle: null
    };
    return; // Stop further processing
  }

  // 4. Marker placement now initiated via UI controls
}

function handleVRInputEnd(event) {
  const source = event.target;
  // Only clear the drag info if the event source matches the one that started the drag
  if (vrDraggedInfo.source === source) {
    // Clear any stored positions for rotation calculation
    if (source.userData.lastHandPos) delete source.userData.lastHandPos;
    if (source.userData.lastControllerPos) delete source.userData.lastControllerPos;

    // Reset the state
    vrDraggedInfo = {
      dot: null,
      handle: null,
      source: null,
      isRotating: false,
      isDragging: false
    };
  }
}

// Helper to get a raycaster from either a hand or a controller
function getVRRaycaster(source) {
  const raycaster = new THREE.Raycaster();
  let origin, direction;

  if (source.userData.inputSource && source.userData.inputSource.hand) { // It's a hand
    const handRay = getHandRay(source);
    if (!handRay) return null;
    origin = handRay.origin;
    direction = handRay.direction;
  } else { // It's a controller
    const tempMatrix = new THREE.Matrix4();
    tempMatrix.identity().extractRotation(source.matrixWorld);
    origin = new THREE.Vector3().setFromMatrixPosition(source.matrixWorld);
    direction = new THREE.Vector3(0, 0, -1).applyMatrix4(tempMatrix);
  }
  
  raycaster.set(origin, direction);
  return raycaster;
}


// --- Old VR Handlers (to be replaced) ---
function onVRSelectStart(event) {
  handleVRInputStart(event);
}

function onVRSelectEnd(event) {
  handleVRInputEnd(event);
}

async function onHandPinchStart(event) {
  handleVRInputStart(event);
}

function onHandPinchEnd(event) {
  handleVRInputEnd(event);
}

function getIntersectionPointFromRay(raycaster, blockingObjects = []) {
  // Check if ray intersects the invisible cube at all
  const boxIntersects = raycaster.intersectObject(invisibleCube);
  if (boxIntersects.length === 0) return null;
  
  // Use the FIRST intersection point (entry point into cube volume)
  const cubeHit = boxIntersects[0];
  const intersectPoint = cubeHit.point;
  const cubeDistance = cubeHit.distance;
  
  // If any blocking objects (UI panels, etc.) are closer than the cube, ignore this hit
  if (blockingObjects.length > 0) {
    const epsilon = 0.002;
    for (const blocker of blockingObjects) {
      if (!blocker) continue;
      const blockerHits = raycaster.intersectObject(blocker, true);
      if (blockerHits.length > 0 && blockerHits[0].distance < cubeDistance - epsilon) {
        return null;
      }
    }
  }
  
  // Transform to local cube coordinates
  const intersectLocal = intersectPoint.clone();
  intersectLocal.sub(cubeGroup.position);
  intersectLocal.applyQuaternion(cubeGroup.quaternion.clone().invert());
  
  const halfSize = cubeSize / 2;
  
  // Verify the point is within cube bounds (should be true if intersection worked)
  if (Math.abs(intersectLocal.x) > halfSize ||
      Math.abs(intersectLocal.y) > halfSize ||
      Math.abs(intersectLocal.z) > halfSize) {
    return null; // Safety check: point somehow outside bounds
  }
  
  // Clamp to exact bounds (for floating point precision)
  intersectLocal.x = Math.max(-halfSize, Math.min(halfSize, intersectLocal.x));
  intersectLocal.y = Math.max(-halfSize, Math.min(halfSize, intersectLocal.y));
  intersectLocal.z = Math.max(-halfSize, Math.min(halfSize, intersectLocal.z));
  
  return intersectLocal;
}

function getHandRay(hand) {
  if (!hand || !hand.joints) return null;
  const indexTip = hand.joints['index-finger-tip'];
  const indexIntermediate = hand.joints['index-finger-phalanx-intermediate'];

  if (!indexTip || !indexIntermediate) return null;
  
  const origin = new THREE.Vector3();
  indexTip.getWorldPosition(origin);
  
  const direction = new THREE.Vector3();
  const proximalPos = new THREE.Vector3();
  indexIntermediate.getWorldPosition(proximalPos);

  direction.subVectors(origin, proximalPos).normalize();
  
  return { origin, direction, indexTip };
}

function getBlockingObjects() {
  const blockers = [];
  if (vrUIPanel) {
    vrUIPanel.children.forEach(child => blockers.push(child));
  }
  if (vrSpectrographPlane) {
    blockers.push(vrSpectrographPlane);
  }
  return blockers;
}

// This function is now obsolete as its logic is in handleVRInputStart
async function onVRSelect(event) {
  // This function can be safely removed or left empty.
  // The 'select' event is for a full click (start and end).
  // We handle everything on 'selectstart' for better responsiveness.
}

// This function is now obsolete as its logic is in the animate loop
function handleVRControllerRaycast(controller, index) {
  // This function can be safely removed or left empty.
  // All dragging and rotation logic is now in the main animate() loop
  // based on the unified vrDraggedInfo state.
}

renderer.domElement.addEventListener('mousedown', onMouseDown);
renderer.domElement.addEventListener('mousemove', onMouseMove);
renderer.domElement.addEventListener('mouseup', onMouseUp);
renderer.domElement.addEventListener('wheel', onMouseWheel, { passive: false });
document.addEventListener('keydown', onKeyDown);

// ============ PURE WEBGL SPECTROGRAM (Chrome Music Lab Style) ============
const spectroCanvas = document.getElementById('spectrograph');
const bufferLength = analyser.frequencyBinCount;
const dataArray = new Uint8Array(bufferLength);

// WebGL setup (preserveDrawingBuffer enables reliable downloads/screenshots)
let gl = null;
if (spectroCanvas) {
  gl = spectroCanvas.getContext('webgl', { antialias: true, preserveDrawingBuffer: true });
}
if (!gl) {
  console.error('WebGL not supported');
}

// Constants matching Chrome Music Lab
const SPECTRO_WIDTH = 256;
const SPECTRO_HEIGHT = 256;
const SPECTRO_GEOMETRY_SIZE = 12;
const SPECTRO_TEXTURE_HEIGHT = 256;
const SPECTRO_VERTICAL_SCALE = SPECTRO_GEOMETRY_SIZE / 3.5;

// Frequency data buffer
const freqByteData = new Uint8Array(bufferLength);
let spectroYOffset = 0;

// Compile shader helper
function compileShader(gl, source, type) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('Shader compile error:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

// Create shader program helper
function createProgram(gl, vertexSource, fragmentSource) {
  const vertexShader = compileShader(gl, vertexSource, gl.VERTEX_SHADER);
  const fragmentShader = compileShader(gl, fragmentSource, gl.FRAGMENT_SHADER);
  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('Program link error:', gl.getProgramInfoLog(program));
    return null;
  }
  return program;
}

// Vertex shader (matches Chrome Music Lab exactly)
const spectroVertexSource = `
attribute vec3 gPosition;
attribute vec2 gTexCoord0;
uniform sampler2D vertexFrequencyData;
uniform float vertexYOffset;
uniform mat4 worldViewProjection;
uniform float verticalScale;

varying vec2 texCoord;
varying vec3 color;

vec3 convertHSVToRGB(float hue, float saturation, float lightness) {
  float chroma = lightness * saturation;
  float hueDash = hue / 60.0;
  float x = chroma * (1.0 - abs(mod(hueDash, 2.0) - 1.0));
  vec3 hsv = vec3(0.0);

  if(hueDash < 1.0) {
    hsv.r = chroma;
    hsv.g = x;
  } else if (hueDash < 2.0) {
    hsv.r = x;
    hsv.g = chroma;
  } else if (hueDash < 3.0) {
    hsv.g = chroma;
    hsv.b = x;
  } else if (hueDash < 4.0) {
    hsv.g = x;
    hsv.b = chroma;
  } else if (hueDash < 5.0) {
    hsv.r = x;
    hsv.b = chroma;
  } else if (hueDash < 6.0) {
    hsv.r = chroma;
    hsv.b = x;
  }

  return hsv;
}

void main() {
  float x = pow(256.0, gTexCoord0.x - 1.0);
  vec4 sample = texture2D(vertexFrequencyData, vec2(x, gTexCoord0.y + vertexYOffset));
  vec4 newPosition = vec4(gPosition.x, gPosition.y + verticalScale * sample.a, gPosition.z, 1.0);
  gl_Position = worldViewProjection * newPosition;
  texCoord = gTexCoord0;

  float hue = 360.0 - ((newPosition.y / verticalScale) * 360.0);
  color = convertHSVToRGB(hue, 1.0, 1.0);
}
`;

// Fragment shader (matches Chrome Music Lab exactly)
const spectroFragmentSource = `
precision mediump float;

varying vec2 texCoord;
varying vec3 color;

uniform sampler2D frequencyData;
uniform vec4 foregroundColor;
uniform vec4 backgroundColor;
uniform float yoffset;

void main() {
  float x = pow(256.0, texCoord.x - 1.0);
  float y = texCoord.y + yoffset;

  vec4 sample = texture2D(frequencyData, vec2(x, y));
  float k = sample.a;

  // Fade out the mesh close to both edges (start and end of time)
  float fade = pow(cos((1.0 - texCoord.y) * 0.5 * 3.1415926535), 0.5);
  k *= fade;
  gl_FragColor = backgroundColor + vec4(k * color, 1.0);
}
`;

// Create shader program
const spectroProgram = createProgram(gl, spectroVertexSource, spectroFragmentSource);

// Get attribute/uniform locations
const gPositionLoc = gl.getAttribLocation(spectroProgram, 'gPosition');
const gTexCoord0Loc = gl.getAttribLocation(spectroProgram, 'gTexCoord0');
const vertexFrequencyDataLoc = gl.getUniformLocation(spectroProgram, 'vertexFrequencyData');
const vertexYOffsetLoc = gl.getUniformLocation(spectroProgram, 'vertexYOffset');
const worldViewProjectionLoc = gl.getUniformLocation(spectroProgram, 'worldViewProjection');
const verticalScaleLoc = gl.getUniformLocation(spectroProgram, 'verticalScale');
const frequencyDataLoc = gl.getUniformLocation(spectroProgram, 'frequencyData');
const foregroundColorLoc = gl.getUniformLocation(spectroProgram, 'foregroundColor');
const backgroundColorLoc = gl.getUniformLocation(spectroProgram, 'backgroundColor');
const yoffsetLoc = gl.getUniformLocation(spectroProgram, 'yoffset');

// Create 3D mesh vertices and texture coordinates (like Chrome)
const numVertices = SPECTRO_WIDTH * SPECTRO_HEIGHT;
const vertices = new Float32Array(numVertices * 3);
const texCoords = new Float32Array(numVertices * 2);
const SPECTRO_X_SCALE = 1.4; // Stretch width (frequency axis)
const SPECTRO_Z_SCALE = 0.9; // Depth (time axis)
const SPECTRO_Z_OFFSET = 1.5; // Offset to keep fade-out end fixed while extending spawn end

for (let z = 0; z < SPECTRO_HEIGHT; z++) {
  for (let x = 0; x < SPECTRO_WIDTH; x++) {
    const idx = SPECTRO_WIDTH * z + x;
    vertices[3 * idx + 0] = SPECTRO_GEOMETRY_SIZE * SPECTRO_X_SCALE * (x - SPECTRO_WIDTH / 2) / SPECTRO_WIDTH;
    vertices[3 * idx + 1] = 0;
    vertices[3 * idx + 2] = SPECTRO_GEOMETRY_SIZE * SPECTRO_Z_SCALE * (z - SPECTRO_HEIGHT / 2) / SPECTRO_HEIGHT + SPECTRO_Z_OFFSET;
    
    texCoords[2 * idx + 0] = x / (SPECTRO_WIDTH - 1);
    texCoords[2 * idx + 1] = z / (SPECTRO_HEIGHT - 1);
  }
}

// Create VBO for vertices and texcoords
const spectroVBO = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, spectroVBO);
gl.bufferData(gl.ARRAY_BUFFER, vertices.byteLength + texCoords.byteLength, gl.STATIC_DRAW);
gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertices);
gl.bufferSubData(gl.ARRAY_BUFFER, vertices.byteLength, texCoords);
const vboTexCoordOffset = vertices.byteLength;

// Create indices (like Chrome - with triangle removal for seam)
let spectroNumIndices = (SPECTRO_WIDTH - 1) * (SPECTRO_HEIGHT - 1) * 6;
const ROWS_TO_SKIP = 10; // Remove triangles at the wrap seam
spectroNumIndices = spectroNumIndices - (6 * ROWS_TO_SKIP * (SPECTRO_WIDTH - 1));

const indices = new Uint16Array((SPECTRO_WIDTH - 1) * (SPECTRO_HEIGHT - 1) * 6);
let idx = 0;
for (let z = 0; z < SPECTRO_HEIGHT - 1; z++) {
  for (let x = 0; x < SPECTRO_WIDTH - 1; x++) {
    indices[idx++] = z * SPECTRO_WIDTH + x;
    indices[idx++] = z * SPECTRO_WIDTH + x + 1;
    indices[idx++] = (z + 1) * SPECTRO_WIDTH + x + 1;
    indices[idx++] = z * SPECTRO_WIDTH + x;
    indices[idx++] = (z + 1) * SPECTRO_WIDTH + x + 1;
    indices[idx++] = (z + 1) * SPECTRO_WIDTH + x;
  }
}

const spectroIBO = gl.createBuffer();
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, spectroIBO);
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

// Create texture for frequency data
const spectroTexture = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, spectroTexture);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
const textureData = new Uint8Array(bufferLength * SPECTRO_TEXTURE_HEIGHT);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.ALPHA, bufferLength, SPECTRO_TEXTURE_HEIGHT, 0, gl.ALPHA, gl.UNSIGNED_BYTE, textureData);

// Matrix4x4 class - exact copy from Chrome Music Lab
class Matrix4x4 {
  constructor() {
    this.elements = new Float32Array(16);
    this.loadIdentity();
  }
  
  loadIdentity() {
    for (let i = 0; i < 16; i++) this.elements[i] = 0;
    this.elements[0] = 1;
    this.elements[5] = 1;
    this.elements[10] = 1;
    this.elements[15] = 1;
    return this;
  }
  
  translate(tx, ty, tz) {
    this.elements[12] += this.elements[0] * tx + this.elements[4] * ty + this.elements[8] * tz;
    this.elements[13] += this.elements[1] * tx + this.elements[5] * ty + this.elements[9] * tz;
    this.elements[14] += this.elements[2] * tx + this.elements[6] * ty + this.elements[10] * tz;
    this.elements[15] += this.elements[3] * tx + this.elements[7] * ty + this.elements[11] * tz;
    return this;
  }
  
  rotate(angle, x, y, z) {
    const mag = Math.sqrt(x*x + y*y + z*z);
    const sinAngle = Math.sin(angle * Math.PI / 180.0);
    const cosAngle = Math.cos(angle * Math.PI / 180.0);
    
    if (mag > 0) {
      x /= mag;
      y /= mag;
      z /= mag;
      
      const xx = x * x;
      const yy = y * y;
      const zz = z * z;
      const xy = x * y;
      const yz = y * z;
      const zx = z * x;
      const xs = x * sinAngle;
      const ys = y * sinAngle;
      const zs = z * sinAngle;
      const oneMinusCos = 1.0 - cosAngle;
      
      const rotMat = new Matrix4x4();
      
      rotMat.elements[0] = (oneMinusCos * xx) + cosAngle;
      rotMat.elements[1] = (oneMinusCos * xy) - zs;
      rotMat.elements[2] = (oneMinusCos * zx) + ys;
      rotMat.elements[3] = 0.0;
      
      rotMat.elements[4] = (oneMinusCos * xy) + zs;
      rotMat.elements[5] = (oneMinusCos * yy) + cosAngle;
      rotMat.elements[6] = (oneMinusCos * yz) - xs;
      rotMat.elements[7] = 0.0;
      
      rotMat.elements[8] = (oneMinusCos * zx) - ys;
      rotMat.elements[9] = (oneMinusCos * yz) + xs;
      rotMat.elements[10] = (oneMinusCos * zz) + cosAngle;
      rotMat.elements[11] = 0.0;
      
      rotMat.elements[12] = 0.0;
      rotMat.elements[13] = 0.0;
      rotMat.elements[14] = 0.0;
      rotMat.elements[15] = 1.0;
      
      const result = rotMat.multiply(this);
      this.elements = result.elements;
    }
    return this;
  }
  
  multiply(other) {
    const result = new Matrix4x4();
    for (let i = 0; i < 4; i++) {
      result.elements[i*4+0] = this.elements[i*4+0] * other.elements[0] + 
                               this.elements[i*4+1] * other.elements[4] + 
                               this.elements[i*4+2] * other.elements[8] + 
                               this.elements[i*4+3] * other.elements[12];
      result.elements[i*4+1] = this.elements[i*4+0] * other.elements[1] + 
                               this.elements[i*4+1] * other.elements[5] + 
                               this.elements[i*4+2] * other.elements[9] + 
                               this.elements[i*4+3] * other.elements[13];
      result.elements[i*4+2] = this.elements[i*4+0] * other.elements[2] + 
                               this.elements[i*4+1] * other.elements[6] + 
                               this.elements[i*4+2] * other.elements[10] + 
                               this.elements[i*4+3] * other.elements[14];
      result.elements[i*4+3] = this.elements[i*4+0] * other.elements[3] + 
                               this.elements[i*4+1] * other.elements[7] + 
                               this.elements[i*4+2] * other.elements[11] + 
                               this.elements[i*4+3] * other.elements[15];
    }
    return result;
  }
  
  perspective(fovy, aspect, nearZ, farZ) {
    const frustumH = Math.tan(fovy / 360.0 * Math.PI) * nearZ;
    const frustumW = frustumH * aspect;
    return this.frustum(-frustumW, frustumW, -frustumH, frustumH, nearZ, farZ);
  }
  
  frustum(left, right, bottom, top, nearZ, farZ) {
    const deltaX = right - left;
    const deltaY = top - bottom;
    const deltaZ = farZ - nearZ;
    
    if (nearZ <= 0 || farZ <= 0 || deltaX <= 0 || deltaY <= 0 || deltaZ <= 0)
      return this;
    
    const frust = new Matrix4x4();
    
    frust.elements[0] = 2.0 * nearZ / deltaX;
    frust.elements[1] = frust.elements[2] = frust.elements[3] = 0.0;
    
    frust.elements[5] = 2.0 * nearZ / deltaY;
    frust.elements[4] = frust.elements[6] = frust.elements[7] = 0.0;
    
    frust.elements[8] = (right + left) / deltaX;
    frust.elements[9] = (top + bottom) / deltaY;
    frust.elements[10] = -(nearZ + farZ) / deltaZ;
    frust.elements[11] = -1.0;
    
    frust.elements[14] = -2.0 * nearZ * farZ / deltaZ;
    frust.elements[12] = frust.elements[13] = frust.elements[15] = 0.0;
    
    const result = frust.multiply(this);
    this.elements = result.elements;
    return this;
  }
}

// Camera settings - exact Chrome Music Lab values (in degrees)
const cameraXRot = -180;
const cameraYRot = 270;
const cameraZRot = 90;
const cameraXT = 0;
const cameraYT = -4;
const cameraZT = -4;

// WebGL state
gl.clearColor(0.0, 0.0, 0.0, 1);
gl.enable(gl.DEPTH_TEST);

let spectroTextureWriteIndex = 0;

const descriptorReadouts = {
  centroid: document.getElementById('readout-centroid'),
  noisiness: document.getElementById('readout-noisiness'),
  inharm: document.getElementById('readout-inharm')
};

function updateDescriptorReadouts(values) {
  if (!descriptorReadouts.centroid) {
    return;
  }
  if (!values) {
    descriptorReadouts.centroid.textContent = '--';
    descriptorReadouts.noisiness.textContent = '--';
    descriptorReadouts.inharm.textContent = '--';
    return;
  }
  descriptorReadouts.centroid.textContent = values.centroid.toFixed(2);
  descriptorReadouts.noisiness.textContent = values.noisiness.toFixed(2);
  descriptorReadouts.inharm.textContent = values.inharm.toFixed(2);
}

let vrUIPanel = null;
let vrSpectrographPlane = null;
let vrSpectrographTexture = null;

function updateSpectrographTexture() {
  analyser.getByteFrequencyData(freqByteData);
  
  // Upload texture row (like Chrome)
  gl.bindTexture(gl.TEXTURE_2D, spectroTexture);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, spectroYOffset, bufferLength, 1, gl.ALPHA, gl.UNSIGNED_BYTE, freqByteData);
  
  // Increment AFTER writing (like Chrome)
  spectroYOffset = (spectroYOffset + 1) % SPECTRO_TEXTURE_HEIGHT;
}

function drawSpectrograph() {
  requestAnimationFrame(drawSpectrograph);
  updateSpectrographTexture();
  
  const canvas = spectroCanvas;
  const width = canvas.clientWidth || canvas.width;
  const height = canvas.clientHeight || canvas.height;
  
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  gl.viewport(0, 0, width, height);
  
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  
  gl.useProgram(spectroProgram);
  
  // Build MVP matrix (exact Chrome Music Lab approach)
  const aspect = width / height;
  
  const projection = new Matrix4x4();
  projection.perspective(55, aspect, 1, 100);
  
  const view = new Matrix4x4();
  view.translate(0, 0, -12.0);
  
  const model = new Matrix4x4();
  model.rotate(cameraXRot, 1, 0, 0);
  model.rotate(cameraYRot, 0, 1, 0);
  model.rotate(cameraZRot, 0, 0, 1);
  model.translate(cameraXT, cameraYT, cameraZT);
  
  // Compute MVP: model * view * projection
  let mvp = model.multiply(view);
  mvp = mvp.multiply(projection);
  
  gl.uniformMatrix4fv(worldViewProjectionLoc, false, mvp.elements);
  
  // Set uniforms
  const normalizedYOffset = spectroYOffset / (SPECTRO_TEXTURE_HEIGHT - 1);
  const discretizedYOffset = Math.floor(normalizedYOffset * (SPECTRO_HEIGHT - 1)) / (SPECTRO_HEIGHT - 1);
  
  gl.uniform1i(vertexFrequencyDataLoc, 0);
  gl.uniform1f(vertexYOffsetLoc, discretizedYOffset);
  gl.uniform1f(verticalScaleLoc, SPECTRO_VERTICAL_SCALE);
  gl.uniform1i(frequencyDataLoc, 0);
  gl.uniform4fv(foregroundColorLoc, [0, 0.7, 0, 1]);
  gl.uniform4fv(backgroundColorLoc, [0.0, 0.0, 0.0, 1]);
  gl.uniform1f(yoffsetLoc, normalizedYOffset);
  
  // Bind VBO
  gl.bindBuffer(gl.ARRAY_BUFFER, spectroVBO);
  gl.enableVertexAttribArray(gPositionLoc);
  gl.vertexAttribPointer(gPositionLoc, 3, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(gTexCoord0Loc);
  gl.vertexAttribPointer(gTexCoord0Loc, 2, gl.FLOAT, false, 0, vboTexCoordOffset);
  
  // Draw
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, spectroIBO);
  gl.drawElements(gl.TRIANGLES, spectroNumIndices, gl.UNSIGNED_SHORT, 0);
  
  gl.disableVertexAttribArray(gPositionLoc);
  gl.disableVertexAttribArray(gTexCoord0Loc);
}
drawSpectrograph();

// --- ANIMATION LOOP ---

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
  
  const placeBtn = createButton('Place Marker', '#ffb300', 0);
  const downloadBtn = createButton('Download', '#4CAF50', 1);
  const clearBtn = createButton('Clear', '#f44336', 2);
  const resetBtn = createButton('Reset', '#2196F3', 3);
  
  panelGroup.add(placeBtn);
  panelGroup.add(downloadBtn);
  panelGroup.add(clearBtn);
  panelGroup.add(resetBtn);
  panelGroup.position.set(-1.5, 1.5, -1);
  panelGroup.lookAt(camera.position);
  scene.add(panelGroup);
  vrUIPanel = panelGroup;
  
  // Create floating spectrograph - will be positioned behind cube in animate loop
  vrSpectrographTexture = new THREE.CanvasTexture(spectroRenderer.domElement);
  vrSpectrographTexture.minFilter = THREE.LinearFilter;
  vrSpectrographTexture.magFilter = THREE.LinearFilter;
  vrSpectrographTexture.encoding = THREE.sRGBEncoding;
  const spectroMaterial = new THREE.MeshBasicMaterial({ 
    map: vrSpectrographTexture,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.95
  });
  const spectroGeometry = new THREE.PlaneGeometry(1.2, 0.7); // Larger for better visibility
  vrSpectrographPlane = new THREE.Mesh(spectroGeometry, spectroMaterial);
  // Initial position - will be updated each frame to stay behind cube
  vrSpectrographPlane.position.set(0, 0, 3);
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

function handleVRUIClick(button) {
  if (!button) return;

  // Visual feedback: flash button
  const originalColor = button.material.color.getHex();
  button.material.color.setHex(0xffffff);
  setTimeout(() => {
    button.material.color.setHex(originalColor);
  }, 150);

  const action = button.userData.buttonAction;
  if (action === 'place marker') {
    ensureAudioStarted().then(() => {
      addDotAtPoint(purePoint.clone());
    });
  } else if (action === 'download') {
    const link = document.createElement('a');
    link.download = 'spectrograph.png';
    link.href = spectroCanvas.toDataURL();
    link.click();
  } else if (action === 'clear') {
    while (dots.length > 0) {
      destroyDot(dots[0]);
    }
    if (hoverMarker) {
      hoverMarker.visible = false;
    }
    draggedDot = null;
  } else if (action === 'reset') {
    cubeGroup.rotation.x = 0;
    cubeGroup.rotation.y = Math.PI / 12;
    cubeGroup.rotation.z = 0;
  }
}

function animate() {
  renderer.setAnimationLoop(animate);

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

  // --- VR-SPECIFIC LOGIC ---
  if (renderer.xr.isPresenting) {
    if (hoverMarker) {
      hoverMarker.visible = false;
    }
    // --- UNIFIED POINTER AND VISUALIZATION LOGIC ---
    const activeControllers = [...controllers, ...hands];
    activeControllers.forEach((source, index) => {
      if (!source || !source.visible) return;

      const isHand = !!source.joints;
      const handModel = isHand ? handModels[hands.indexOf(source)] : null;
      const controllerLine = isHand ? null : source.getObjectByName('line');

      // Set visibility of default controller line vs hand visuals
      if (controllerLine) controllerLine.visible = !isHand;
      if (isHand && handModel) {
          for (const jointName in handModel.spheres) {
              const sphere = handModel.spheres[jointName];
              if (sphere) sphere.visible = true;
          }
      }

      // Get ray for this source
      const raycaster = getVRRaycaster(source);
      if (!raycaster) {
          // Hide pointer if no valid ray
          if (handModel && handModel.pointerRay) handModel.pointerRay.visible = false;
          return;
      }

      // Update hand pointer ray
      if (isHand && handModel) {
        if (!handModel.pointerRay) {
          const rayGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
          const rayLine = new THREE.Line(rayGeometry, new THREE.LineBasicMaterial({ color: 0x88ff00, linewidth: 2, transparent: true, opacity: 0.8 }));
          rayLine.scale.z = 5;
          rayLine.renderOrder = 10;
          scene.add(rayLine);
          handModel.pointerRay = rayLine;
        }
        const pointerRay = handModel.pointerRay;
        pointerRay.position.copy(raycaster.ray.origin);
        pointerRay.quaternion.setFromUnitVectors(NEG_Z, raycaster.ray.direction);
        pointerRay.visible = !vrDraggedInfo.isDragging && !vrDraggedInfo.isRotating;
      }

      // Update hover crosshairs (only if not dragging/rotating)
      const vrHoverLines = isHand && hands.indexOf(source) === 0 ? vrHoverLinesLeft : vrHoverLinesRight;
      const isLeft = isHand && hands.indexOf(source) === 0;

      if (isLeft && vrHoverLinesLeft) { cubeGroup.remove(vrHoverLinesLeft); vrHoverLinesLeft = null; }
      if (!isLeft && vrHoverLinesRight) { cubeGroup.remove(vrHoverLinesRight); vrHoverLinesRight = null; }

      if (!vrDraggedInfo.isDragging && !vrDraggedInfo.isRotating) {
          const point = getIntersectionPointFromRay(raycaster, getBlockingObjects());
          if (point) {
              const newHoverLines = createHoverLines(point);
              cubeGroup.add(newHoverLines);
              if (isLeft) vrHoverLinesLeft = newHoverLines;
              else vrHoverLinesRight = newHoverLines;
          }
      }
    });

    // --- UNIFIED DRAGGING AND ROTATION LOGIC ---
    if (vrDraggedInfo.isRotating) {
      const source = vrDraggedInfo.source;
      if (source.userData.inputSource && source.userData.inputSource.hand) { // Hand rotation
        const indexTip = source.joints['index-finger-tip'];
        if (indexTip && source.userData.lastHandPos) {
          const currentPos = new THREE.Vector3().setFromMatrixPosition(indexTip.matrixWorld);
          const delta = currentPos.clone().sub(source.userData.lastHandPos);
          cubeGroup.rotation.y += delta.x * 3;
          cubeGroup.rotation.x += delta.y * 3;
          source.userData.lastHandPos.copy(currentPos);
        }
      } else { // Controller rotation
        if (source.userData.lastControllerPos) {
          const currentPos = new THREE.Vector3().setFromMatrixPosition(source.matrixWorld);
          const delta = currentPos.clone().sub(source.userData.lastControllerPos);
          cubeGroup.rotation.y += delta.x * 3;
          cubeGroup.rotation.x -= delta.y * 3; // Note: controller rotation might feel different
          source.userData.lastControllerPos.copy(currentPos);
        }
      }
    }

    if (vrDraggedInfo.isDragging) {
      const source = vrDraggedInfo.source;
      const dot = vrDraggedInfo.dot;
      const raycaster = getVRRaycaster(source);
      if (raycaster && dot) {
        const point = getIntersectionPointFromRay(raycaster, getBlockingObjects());
        if (point) {
          dot.mesh.position.copy(point);
          dot.shadow.position.set(point.x, -cubeSize / 2, point.z);

          if (dot.crosshairs) {
            cubeGroup.remove(dot.crosshairs);
            dot.crosshairs = createHoverLines(point, true);
            cubeGroup.add(dot.crosshairs);
          }

          const normalized = normalizeTimbreCoords(point);
          dot.x = normalized.x;
          dot.y = normalized.y;
          dot.z = normalized.z;
          updateDotAudio(dot);
          dot.mesh.visible = true;
        } else {
          // If ray doesn't intersect cube, hide the dot (visual cue for deletion on release)
          dot.mesh.visible = false;
        }
      }
    }
    
    // Update hand joint visualizations
    hands.forEach((hand, index) => {
      if (hand && hand.joints) {
        const handModel = handModels[index];
        for (const [jointName, joint] of Object.entries(hand.joints)) {
          if (joint) {
            if (!handModel.spheres[jointName]) {
              const isTip = jointName.includes('tip');
              const radius = isTip ? 0.012 : 0.008;
              const sphereGeometry = new THREE.SphereGeometry(radius, 16, 16);
              const sphereMaterial = new THREE.MeshStandardMaterial({
                color: isTip ? 0x00ff88 : 0x00aaff,
                emissive: isTip ? 0x00ff88 : 0x00aaff,
                emissiveIntensity: 0.5,
                metalness: 0.8,
                roughness: 0.2
              });
              const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
              sphere.castShadow = true;
              hand.add(sphere); // Add to the hand itself for relative positioning
              handModel.spheres[jointName] = sphere;
            }
            const sphere = handModel.spheres[jointName];
            sphere.position.copy(joint.position);
            sphere.quaternion.copy(joint.quaternion);
            sphere.visible = renderer.xr.isPresenting;
          }
        }
      }
    });
    
    // Update VR UI and spectrograph positions to follow camera
    if (vrSpectrographPlane) {
      try {
        const xrCamera = renderer.xr.getCamera();
        
        if (xrCamera) {
          // Get camera direction (where user is looking from)
          const cameraDirection = new THREE.Vector3();
          xrCamera.getWorldDirection(cameraDirection);
          
          // Calculate vector from camera to cube
          const cameraToCube = new THREE.Vector3();
          cameraToCube.subVectors(cubeGroup.position, xrCamera.position).normalize();
          
          // Position spectrograph behind cube (opposite side from camera)
          // This ensures it's always visible behind the cube relative to user
          const distanceBehindCube = 2.5;
          const spectroPos = cubeGroup.position.clone();
          spectroPos.add(cameraToCube.multiplyScalar(distanceBehindCube));
          
          vrSpectrographPlane.position.copy(spectroPos);
          vrSpectrographPlane.lookAt(xrCamera.position); // Always face the user
          
          // Update texture
          vrSpectrographTexture.needsUpdate = true;
          
          // Keep UI panel in a fixed position relative to cube
          if (vrUIPanel) {
            const uiPos = cubeGroup.position.clone();
            const rightOffset = new THREE.Vector3();
            xrCamera.getWorldDirection(rightOffset);
            rightOffset.cross(xrCamera.up).normalize().multiplyScalar(-2);
            const upOffset = xrCamera.up.clone().normalize().multiplyScalar(1.5);
            uiPos.add(rightOffset).add(upOffset);
            vrUIPanel.position.copy(uiPos);
            vrUIPanel.lookAt(xrCamera.position);
          }
        }
      } catch (err) {
        // Silently catch VR camera errors during initialization
        console.warn('VR camera not ready yet:', err.message);
      }
    }
  } else {
    // --- DESKTOP MOUSE HOVER LOGIC ---
    if (hoverLines) {
      hoverLines.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
      cubeGroup.remove(hoverLines);
      hoverLines = null;
    }

    if (hoverMarker) {
      hoverMarker.visible = false;
    }
  }
  
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
const playPauseButton = document.getElementById('play-pause');
if (playPauseButton) {
  playPauseButton.addEventListener('click', async () => {
    await ensureAudioStarted();
    await setPlaying(!isPlaying);
  });
}

document.getElementById('place-marker').addEventListener('click', async () => {
  await ensureAudioStarted();
  addDotAtPoint(purePoint.clone());
});

document.getElementById('download').addEventListener('click', () => {
  const canvas = spectroCanvas || renderer.domElement;
  if (!canvas) return;
  const link = document.createElement('a');
  link.download = 'spectrograph.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
});

document.getElementById('clear').addEventListener('click', () => {
  while (dots.length > 0) {
    destroyDot(dots[0]);
  }
  if (hoverMarker) {
    hoverMarker.visible = false;
  }
  draggedDot = null;
});

document.getElementById('reset-position').addEventListener('click', () => {
  // Reset cube rotation to initial state
  cubeGroup.rotation.x = 0;
  cubeGroup.rotation.y = Math.PI / 12; // Initial Y rotation (15 degrees)
  cubeGroup.rotation.z = 0;
});
