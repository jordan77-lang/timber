
(function () {

    // --- XRHandPrimitiveModel ---
    const _matrix = new THREE.Matrix4();
    const _vector = new THREE.Vector3();

    THREE.XRHandPrimitiveModel = class XRHandPrimitiveModel {

        constructor(handModel, controller, path, handedness, options) {
            this.controller = controller;
            this.handModel = handModel;
            this.envMap = null;

            let geometry;
            if (!options || !options.primitive || options.primitive === 'sphere') {
                geometry = new THREE.SphereGeometry(0.008, 10, 10);
            } else if (options.primitive === 'box') {
                geometry = new THREE.BoxGeometry(0.012, 0.012, 0.012);
            }

            const material = new THREE.MeshStandardMaterial({ color: 0x00ccff, roughness: 0.2, metalness: 0.8 }); // Default Blue Hologram

            // 1. Joints (Instance Mesh)
            this.handMesh = new THREE.InstancedMesh(geometry, material, 30);
            this.handMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            this.handMesh.castShadow = true;
            this.handMesh.receiveShadow = true;
            this.handModel.add(this.handMesh);

            // 2. Bones (Cylinders) - connecting joints
            // List of bone connections (Parent -> Child)
            this.boneMap = [
                ['wrist', 'thumb-metacarpal'],
                ['thumb-metacarpal', 'thumb-phalanx-proximal'],
                ['thumb-phalanx-proximal', 'thumb-phalanx-distal'],
                ['thumb-phalanx-distal', 'thumb-tip'],

                ['wrist', 'index-finger-metacarpal'],
                ['index-finger-metacarpal', 'index-finger-phalanx-proximal'],
                ['index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate'],
                ['index-finger-phalanx-intermediate', 'index-finger-phalanx-distal'],
                ['index-finger-phalanx-distal', 'index-finger-tip'],

                ['wrist', 'middle-finger-metacarpal'],
                ['middle-finger-metacarpal', 'middle-finger-phalanx-proximal'],
                ['middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate'],
                ['middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal'],
                ['middle-finger-phalanx-distal', 'middle-finger-tip'],

                ['wrist', 'ring-finger-metacarpal'],
                ['ring-finger-metacarpal', 'ring-finger-phalanx-proximal'],
                ['ring-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate'],
                ['ring-finger-phalanx-intermediate', 'ring-finger-phalanx-distal'],
                ['ring-finger-phalanx-distal', 'ring-finger-tip'],

                ['wrist', 'pinky-finger-metacarpal'],
                ['pinky-finger-metacarpal', 'pinky-finger-phalanx-proximal'],
                ['pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-intermediate'],
                ['pinky-finger-phalanx-intermediate', 'pinky-finger-phalanx-distal'],
                ['pinky-finger-phalanx-distal', 'pinky-finger-tip']
            ];

            const boneGeo = new THREE.CylinderGeometry(0.004, 0.004, 1, 8);
            boneGeo.rotateX(Math.PI / 2); // Align to Z axis

            const boneMat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 });

            this.boneMesh = new THREE.InstancedMesh(boneGeo, boneMat, 30);
            this.boneMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            this.handModel.add(this.boneMesh);

            this.joints = [
                'wrist',
                'thumb-metacarpal',
                'thumb-phalanx-proximal',
                'thumb-phalanx-distal',
                'thumb-tip',
                'index-finger-metacarpal',
                'index-finger-phalanx-proximal',
                'index-finger-phalanx-intermediate',
                'index-finger-phalanx-distal',
                'index-finger-tip',
                'middle-finger-metacarpal',
                'middle-finger-phalanx-proximal',
                'middle-finger-phalanx-intermediate',
                'middle-finger-phalanx-distal',
                'middle-finger-tip',
                'ring-finger-metacarpal',
                'ring-finger-phalanx-proximal',
                'ring-finger-phalanx-intermediate',
                'ring-finger-phalanx-distal',
                'ring-finger-tip',
                'pinky-finger-metacarpal',
                'pinky-finger-phalanx-proximal',
                'pinky-finger-phalanx-intermediate',
                'pinky-finger-phalanx-distal',
                'pinky-finger-tip'
            ];
        }

        updateMesh() {
            const defaultRadius = 0.008;
            const joints = this.controller.joints;
            let count = 0;

            // Update Joints
            for (let i = 0; i < this.joints.length; i++) {
                const joint = joints[this.joints[i]];
                if (joint && joint.visible) {
                    _vector.setScalar(joint.jointRadius || defaultRadius);
                    _matrix.compose(joint.position, joint.quaternion, _vector);
                    this.handMesh.setMatrixAt(i, _matrix);
                    count++;
                }
            }
            this.handMesh.count = count;
            this.handMesh.instanceMatrix.needsUpdate = true;

            // Update Bones
            let boneCount = 0;
            const tempPos1 = new THREE.Vector3();
            const tempPos2 = new THREE.Vector3();
            const tempQuat = new THREE.Quaternion();
            const tempScale = new THREE.Vector3();
            const up = new THREE.Vector3(0, 1, 0);

            for (let i = 0; i < this.boneMap.length; i++) {
                const joint1 = joints[this.boneMap[i][0]];
                const joint2 = joints[this.boneMap[i][1]];

                if (joint1 && joint2 && joint1.visible && joint2.visible) {
                    tempPos1.copy(joint1.position);
                    tempPos2.copy(joint2.position);

                    const dist = tempPos1.distanceTo(tempPos2);
                    const mid = tempPos1.clone().add(tempPos2).multiplyScalar(0.5);
                    const dir = tempPos2.clone().sub(tempPos1).normalize();
                    tempQuat.setFromUnitVectors(up, dir);
                    tempScale.set(1, dist, 1);
                    _matrix.compose(mid, tempQuat, tempScale);

                    this.boneMesh.setMatrixAt(boneCount, _matrix);
                    boneCount++;
                }
            }
            this.boneMesh.count = boneCount;
            this.boneMesh.instanceMatrix.needsUpdate = true;
        }
    };


    // --- XRHandModel ---
    class XRHandModel extends THREE.Object3D {
        constructor(controller) {
            super();
            this.controller = controller;
            this.motionController = null;
            this.envMap = null;
            this.mesh = null;
        }

        updateMatrixWorld(force) {
            super.updateMatrixWorld(force);
            if (this.motionController) {
                this.motionController.updateMesh();
            }
        }
    }

    // --- XRHandGenericMeshModel (GLB) ---
    class XRHandGenericMeshModel {
        constructor(handModel, controller, path, handedness, options) {
            this.controller = controller;
            this.handModel = handModel;
            this.bones = [];

            const loader = new THREE.GLTFLoader();
            loader.setPath('models/');

            // Generic Hand Asset Name from WebXR Input Profiles
            const fileName = `${handedness}.glb`;
            console.log("Loading Generic Hand GLB:", fileName);

            loader.load(fileName, gltf => {
                const object = gltf.scene;
                this.handModel.add(object);

                // Generic Hand Mapping (Standard WebXR Profile)
                const joints = [
                    'wrist', 'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip',
                    'index-finger-metacarpal', 'index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip',
                    'middle-finger-metacarpal', 'middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal', 'middle-finger-tip',
                    'ring-finger-metacarpal', 'ring-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate', 'ring-finger-phalanx-distal', 'ring-finger-tip',
                    'pinky-finger-metacarpal', 'pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-intermediate', 'pinky-finger-phalanx-distal', 'pinky-finger-tip',
                ];

                // Recursively find bones by name
                joints.forEach(jointName => {
                    const bone = object.getObjectByName(jointName);
                    if (bone !== undefined) {
                        bone.jointName = jointName;
                    } else {
                        // Attempting fallback check for "b_" prefix if exact not found
                        const boneV2 = object.getObjectByName("b_" + jointName);
                        if (boneV2) {
                            boneV2.jointName = jointName;
                            this.bones.push(boneV2);
                            return;
                        }
                        console.warn(`Could not find bone for joint: ${jointName}`);
                    }
                    this.bones.push(bone);
                });
            });
        }

        updateMesh() {
            const XRJoints = this.controller.joints;
            for (let i = 0; i < this.bones.length; i++) {
                const bone = this.bones[i];
                if (bone) {
                    const XRJoint = XRJoints[bone.jointName];
                    if (XRJoint && XRJoint.visible) {
                        const position = XRJoint.position;
                        const quaternion = XRJoint.quaternion;
                        bone.position.copy(position);
                        bone.quaternion.copy(quaternion);
                    }
                }
            }
        }
    }


    // --- XRHandModelFactory ---
    THREE.XRHandModelFactory = class XRHandModelFactory {

        constructor() {
            this.path = '';
        }

        setPath(path) {
            this.path = path;
            return this;
        }

        createHandModel(controller, profile, options) {
            const handModel = new XRHandModel(controller);

            controller.addEventListener('connected', (event) => {
                const xrInputSource = event.data;
                if (xrInputSource.hand && !handModel.motionController) {
                    handModel.visible = true;
                    handModel.xrInputSource = xrInputSource;

                    if (profile === 'boxes') {
                        handModel.motionController = new THREE.XRHandPrimitiveModel(
                            handModel, controller, this.path, xrInputSource.handedness, { primitive: 'box' }
                        );
                    } else if (profile === 'spheres') {
                        handModel.motionController = new THREE.XRHandPrimitiveModel(
                            handModel, controller, this.path, xrInputSource.handedness, { primitive: 'sphere' }
                        );
                    } else {
                        // Default 'mesh' now uses the Generic Hand GLB (Standard Profile)
                        handModel.motionController = new XRHandGenericMeshModel(
                            handModel, controller, this.path, xrInputSource.handedness, options
                        );
                    }
                }
            });
            return handModel;
        }
    };
})();
