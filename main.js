import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

class GlobeViewer {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.globe = null;
        this.currentTexture = null;
        this.lightRotation = 45; // Default light angle in degrees
        this.ambientBrightness = 0.9; // 50% brighter (0.6 * 1.5)
        this.directionalBrightness = 1.2; // 50% brighter (0.8 * 1.5)
        this.autoRotate = true; // Start with auto-rotation enabled
        this.userInteracting = false;
        this.uploadHistory = []; // Store user uploaded textures
        this.db = null; // IndexedDB connection
        this.loadingOverlay = null; // Loading overlay element
        this.dragModal = null; // Drag modal element
        this.currentUploadEntry = null; // Current uploaded texture for saving settings
        
        this.init();
        this.setupDragAndDrop();
        this.setupControls();
        this.setupUIElements();
        this.initIndexedDB(); // Initialize database
        this.animate();
        this.startupSequence(); // Handle startup loading and animation
    }

    init() {
        const canvas = document.getElementById('canvas');
        
        // Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x111111);

        // Camera
        this.camera = new THREE.PerspectiveCamera(
            75, 
            window.innerWidth / window.innerHeight, 
            0.1, 
            1000
        );
        this.camera.position.z = 3;

        // Renderer
        this.renderer = new THREE.WebGLRenderer({ 
            canvas: canvas, 
            antialias: true 
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        
        // Ensure proper color output
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;

        // Create globe
        this.createGlobe();

        // Add camera-following lighting
        this.setupLighting();

        // Controls
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.minDistance = 1.5;
        this.controls.maxDistance = 10;
        this.controls.autoRotate = true; // Enable auto-rotation by default
        this.controls.autoRotateSpeed = -1.0;
        
        // Add event listeners to detect user interaction
        this.controls.addEventListener('start', () => {
            this.userInteracting = true;
            if (this.autoRotate) {
                this.toggleAutoRotate(); // Stop auto rotation when user interacts
            }
        });
        
        this.controls.addEventListener('end', () => {
            this.userInteracting = false;
        });

        // Handle resize
        window.addEventListener('resize', () => this.onWindowResize());
    }

    createGlobe() {
        const geometry = new THREE.SphereGeometry(1, 64, 32);
        
        // Create material with white base - will be properly lit
        const material = new THREE.MeshStandardMaterial({ 
            color: 0xffffff // White base so textures show true colors
        });
        
        this.globe = new THREE.Mesh(geometry, material);
        
        // Start with scale 0 for startup animation
        this.globe.scale.set(0, 0, 0);
        
        this.scene.add(this.globe);
        
        console.log('Initial material created:', {
            type: material.type,
            color: material.color.getHex(),
            map: material.map ? 'present' : 'none'
        });
        
        // Load default texture (loading will be handled by startup sequence)
        this.loadDefaultTexture(true); // Pass flag to skip loading animation
    }

    setupLighting() {
        // Ambient light for overall brightness
        this.ambientLight = new THREE.AmbientLight(0xffffff, this.ambientBrightness);
        this.scene.add(this.ambientLight);

        // Directional light that will follow the camera with offset
        this.directionalLight = new THREE.DirectionalLight(0xffffff, this.directionalBrightness);
        this.scene.add(this.directionalLight);
        
        // Update light position initially
        this.updateLighting();
    }

    updateLighting() {
        // Update light intensities
        this.ambientLight.intensity = this.ambientBrightness;
        this.directionalLight.intensity = this.directionalBrightness;
        
        // Position the directional light to rotate around the globe horizontally
        // Convert rotation angle to radians
        const rotationRad = (this.lightRotation * Math.PI) / 180;
        
        // Position light in a circle around the globe at the same height as camera
        const lightDistance = 5; // Distance from globe center
        const cameraHeight = this.camera.position.y; // Use camera's current height
        
        // Calculate light position rotating around the globe horizontally
        const lightX = Math.cos(rotationRad) * lightDistance;
        const lightZ = Math.sin(rotationRad) * lightDistance;
        
        this.directionalLight.position.set(lightX, cameraHeight, lightZ);
        this.directionalLight.target.position.set(0, 0, 0);
        this.directionalLight.target.updateMatrixWorld();
    }

    loadDefaultTexture(skipLoading = false) {
        // Show loading for default texture (unless skipped for startup)
        if (!skipLoading) {
            this.showLoading('Loading default texture...');
        }
        
        // Try loading image directly first to debug
        const img = new Image();
        img.crossOrigin = 'anonymous';
        
        img.onload = () => {
            console.log('Image loaded successfully:', img.width, 'x', img.height);
            
            // Create texture from loaded image
            const texture = new THREE.Texture(img);
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            texture.needsUpdate = true;
            
            // Try setting colorSpace explicitly
            texture.colorSpace = THREE.SRGBColorSpace;
            
            console.log('Applying texture to material...');
            
            // Update existing material's map - same approach as drag-and-drop
            if (this.currentTexture) {
                this.currentTexture.dispose(); // Clean up old texture
            }
            this.globe.material.map = texture;
            this.globe.material.needsUpdate = true;
            this.currentTexture = texture;
            
            console.log('loadDefaultTexture material details:', {
                type: this.globe.material.type,
                map: this.globe.material.map ? 'present' : 'missing',
                colorSpace: this.globe.material.map?.colorSpace,
                needsUpdate: this.globe.material.needsUpdate
            });
            
            // Force lighting update to ensure proper brightness
            this.updateLighting();
            
            // Hide loading (unless skipped for startup)
            if (!skipLoading) {
                this.hideLoading();
            }
            
            console.log('Texture applied. Material:', this.globe.material);
        };
        
        img.onerror = () => {
            console.warn('Failed to load image, using fallback');
            this.createFallbackTexture();
            // Hide loading and use fallback (unless skipped for startup)
            if (!skipLoading) {
                this.hideLoading();
            }
        };
        
        img.src = 'assets/earth.png';
    }

    createFallbackTexture() {
        // Simple fallback texture - much cleaner than the previous one
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');
        
        // Simple blue sphere
        ctx.fillStyle = '#4169E1'; // Royal blue
        ctx.fillRect(0, 0, 512, 256);
        
        // Add grid lines for reference
        ctx.strokeStyle = '#87CEEB';
        ctx.lineWidth = 1;
        
        // Longitude lines
        for (let x = 0; x < 512; x += 64) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, 256);
            ctx.stroke();
        }
        
        // Latitude lines
        for (let y = 0; y < 256; y += 32) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(512, y);
            ctx.stroke();
        }

        const fallbackTexture = new THREE.CanvasTexture(canvas);
        fallbackTexture.wrapS = THREE.RepeatWrapping;
        fallbackTexture.wrapT = THREE.RepeatWrapping;
        
        this.globe.material.map = fallbackTexture;
        this.globe.material.needsUpdate = true;
        this.currentTexture = fallbackTexture;
    }

    setupDragAndDrop() {
        const container = document.getElementById('container');
        const errorMessage = document.getElementById('error-message');
        let dragCounter = 0; // Track drag enter/leave events to prevent flickering

        // Prevent default drag behaviors on document level
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            document.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
        });

        // Handle drag enter - increment counter
        document.addEventListener('dragenter', (e) => {
            dragCounter++;
            if (dragCounter === 1) {
                container.classList.add('drag-over');
                this.showDragModal();
            }
        });

        // Handle drag over - just prevent default
        document.addEventListener('dragover', (e) => {
            e.preventDefault();
        });

        // Handle drag leave - decrement counter
        document.addEventListener('dragleave', (e) => {
            dragCounter--;
            if (dragCounter === 0) {
                container.classList.remove('drag-over');
                this.hideDragModal();
            }
        });

        // Handle drop
        document.addEventListener('drop', (e) => {
            dragCounter = 0; // Reset counter
            container.classList.remove('drag-over');
            this.hideDragModal();
            
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                this.loadTexture(files[0]);
            }
        });
    }

    showError(message) {
        const errorMessage = document.getElementById('error-message');
        errorMessage.textContent = message;
        errorMessage.classList.remove('hidden');
        
        // Hide error after 5 seconds
        setTimeout(() => {
            errorMessage.classList.add('hidden');
        }, 5000);
    }

    loadTexture(file) {
        // Validate file type
        const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
        if (!validTypes.includes(file.type)) {
            this.showError('Please drop a valid image file (JPG, PNG, or WebP)');
            return;
        }

        // Check file size (warn for very large files)
        const maxSize = 50 * 1024 * 1024; // 50MB
        if (file.size > maxSize) {
            this.showError('Image file is quite large and may cause performance issues');
        }

        // Show loading overlay
        this.showLoading(`Loading ${file.name}...`);

        const reader = new FileReader();
        
        reader.onload = (e) => {
            const img = new Image();
            
            img.onload = () => {
                try {
                    // Dispose of previous texture to free memory
                    if (this.currentTexture) {
                        this.currentTexture.dispose();
                    }
                    
                    // Create new texture
                    const texture = new THREE.Texture(img);
                    texture.wrapS = THREE.RepeatWrapping;
                    texture.wrapT = THREE.RepeatWrapping;
                    texture.colorSpace = THREE.SRGBColorSpace; // Add missing colorSpace setting
                    texture.needsUpdate = true;
                    
                    // Apply to globe
                    this.globe.material.map = texture;
                    this.globe.material.needsUpdate = true;
                    
                    this.currentTexture = texture;
                    
                    console.log('Drag-and-drop applied - current lighting:', {
                        ambient: this.ambientBrightness,
                        directional: this.directionalBrightness,
                        rotation: this.lightRotation
                    });
                    console.log('Drag-and-drop material details:', {
                        type: this.globe.material.type,
                        map: this.globe.material.map ? 'present' : 'missing',
                        colorSpace: this.globe.material.map?.colorSpace,
                        needsUpdate: this.globe.material.needsUpdate
                    });
                    
                    // Force lighting update to ensure consistency
                    this.updateLighting();
                    
                    // Add to upload history
                    this.addToUploadHistory(file, img);
                    
                    // Restart auto-rotation when new texture is loaded
                    if (!this.autoRotate) {
                        this.toggleAutoRotate();
                    }
                    
                    // Hide loading overlay
                    this.hideLoading();
                    
                } catch (error) {
                    console.error('Error loading texture:', error);
                    this.showError('Failed to load image as texture');
                    this.hideLoading(); // Hide loading on error
                }
            };
            
            img.onerror = () => {
                this.showError('Failed to load image - file may be corrupted');
                this.hideLoading(); // Hide loading on error
            };
            
            img.src = e.target.result;
        };
        
        reader.onerror = () => {
            this.showError('Failed to read file');
            this.hideLoading(); // Hide loading on error
        };
        
        reader.readAsDataURL(file);
    }

    setupControls() {
        // Toggle panel visibility
        const controlsToggle = document.getElementById('controls-toggle');
        const controlsPanel = document.getElementById('controls-panel');
        
        controlsToggle.addEventListener('click', () => {
            controlsPanel.classList.toggle('collapsed');
        });

        // Auto-rotation toggle
        const autoRotateButton = document.getElementById('auto-rotate-toggle');
        // Set initial button state since auto-rotation starts enabled
        autoRotateButton.textContent = 'Stop Auto-Rotation';
        autoRotateButton.classList.add('active');
        
        autoRotateButton.addEventListener('click', () => {
            this.toggleAutoRotate();
        });

        // Ambient brightness control
        const ambientBrightnessSlider = document.getElementById('ambient-brightness-slider');
        const ambientBrightnessValue = document.getElementById('ambient-brightness-value');
        
        ambientBrightnessSlider.addEventListener('input', (e) => {
            this.ambientBrightness = parseFloat(e.target.value);
            ambientBrightnessValue.textContent = this.ambientBrightness.toFixed(1);
            this.updateLighting();
        });

        // Directional brightness control
        const directionalBrightnessSlider = document.getElementById('directional-brightness-slider');
        const directionalBrightnessValue = document.getElementById('directional-brightness-value');
        
        directionalBrightnessSlider.addEventListener('input', (e) => {
            this.directionalBrightness = parseFloat(e.target.value);
            directionalBrightnessValue.textContent = this.directionalBrightness.toFixed(1);
            this.updateLighting();
        });

        // Light rotation control
        const lightRotationSlider = document.getElementById('light-rotation-slider');
        const lightRotationValue = document.getElementById('light-rotation-value');
        
        lightRotationSlider.addEventListener('input', (e) => {
            const rotation = parseInt(e.target.value);
            lightRotationValue.textContent = rotation + '°';
            this.lightRotation = rotation;
        });

        // Default textures foldout
        const defaultTexturesHeader = document.getElementById('default-textures-header');
        const defaultTexturesContent = document.getElementById('default-textures-content');
        
        defaultTexturesHeader.addEventListener('click', () => {
            defaultTexturesContent.classList.toggle('collapsed');
        });

        // Uploaded textures foldout
        const uploadedTexturesHeader = document.getElementById('uploaded-textures-header');
        const uploadedTexturesContent = document.getElementById('uploaded-textures-content');
        
        uploadedTexturesHeader.addEventListener('click', () => {
            uploadedTexturesContent.classList.toggle('collapsed');
        });

        // Default texture grid items
        const defaultTextureItems = document.querySelectorAll('#default-textures .texture-item');
        defaultTextureItems.forEach(item => {
            item.addEventListener('click', () => {
                const textureUrl = item.getAttribute('data-url');
                this.loadTextureFromUrl(textureUrl);
            });
        });

        // Clear history button
        const clearHistoryBtn = document.getElementById('clear-history');
        clearHistoryBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent event bubbling to foldout header
            this.clearUploadHistory();
        });

        // Save current settings button
        const saveSettingsBtn = document.getElementById('save-current-settings');
        saveSettingsBtn.addEventListener('click', () => {
            this.saveCurrentSettings();
        });

    }

    toggleAutoRotate() {
        this.autoRotate = !this.autoRotate;
        const button = document.getElementById('auto-rotate-toggle');
        
        if (this.autoRotate) {
            button.textContent = 'Stop Auto-Rotation';
            button.classList.add('active');
            this.controls.autoRotate = true;
            this.controls.autoRotateSpeed = -1.0;
        } else {
            button.textContent = 'Start Auto-Rotation';
            button.classList.remove('active');
            this.controls.autoRotate = false;
        }
    }

    loadTextureFromUrl(url) {
        // Show loading
        const fileName = url.split('/').pop() || 'texture';
        this.showLoading(`Loading ${fileName}...`);
        
        const img = new Image();
        img.crossOrigin = 'anonymous';
        
        img.onload = () => {
            console.log('Example texture loaded:', img.width, 'x', img.height);
            
            // Dispose of old texture
            if (this.currentTexture) {
                this.currentTexture.dispose();
            }
            
            // Create new texture
            const texture = new THREE.Texture(img);
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.needsUpdate = true;
            
            // Create new material
            const newMaterial = new THREE.MeshStandardMaterial({ 
                map: texture,
                transparent: false,
                side: THREE.FrontSide
            });
            
            this.globe.material.dispose();
            this.globe.material = newMaterial;
            this.currentTexture = texture;
            
            // Restart auto-rotation when new texture is loaded
            if (!this.autoRotate) {
                this.toggleAutoRotate();
            }
            
            // Hide loading
            this.hideLoading();
        };
        
        img.onerror = () => {
            this.showError('Failed to load example texture');
            this.hideLoading(); // Hide loading on error
        };
        
        img.src = url;
    }

    loadTextureFromDataUrl(dataUrl, savedSettings = null, fileName = null, uploadEntry = null) {
        // Show loading with filename if available
        const loadingText = fileName ? `Loading ${fileName}...` : 'Loading cached texture...';
        this.showLoading(loadingText);
        
        const img = new Image();
        
        img.onload = () => {
            console.log('Cached texture loaded:', img.width, 'x', img.height);
            
            try {
                // Dispose of old texture
                if (this.currentTexture) {
                    this.currentTexture.dispose();
                }
                
                // Create new texture - same as drag/drop flow
                const texture = new THREE.Texture(img);
                texture.wrapS = THREE.RepeatWrapping;
                texture.wrapT = THREE.RepeatWrapping;
                texture.colorSpace = THREE.SRGBColorSpace;
                texture.needsUpdate = true;
                
                // Apply to globe - EXACT same approach as drag-and-drop
                this.globe.material.map = texture;
                this.globe.material.needsUpdate = true;
                this.currentTexture = texture;
                
                console.log('Before restore - current settings:', {
                    ambient: this.ambientBrightness,
                    directional: this.directionalBrightness,
                    rotation: this.lightRotation
                });
                
                // Set current upload entry so save button works
                this.currentUploadEntry = uploadEntry;
                
                // Restore saved settings if available
                if (savedSettings) {
                    this.restoreSavedSettings(savedSettings);
                    console.log('After restore - applied settings:', savedSettings);
                } else {
                    console.log('No saved settings to restore, using current values');
                }
                
                console.log('Cached texture material details:', {
                    type: this.globe.material.type,
                    map: this.globe.material.map ? 'present' : 'missing',
                    colorSpace: this.globe.material.map?.colorSpace,
                    needsUpdate: this.globe.material.needsUpdate
                });
                
                // Restart auto-rotation when new texture is loaded
                if (this.autoRotate) {
                    this.toggleAutoRotate();
                }
                
                // Hide loading
                this.hideLoading();
                
            } catch (error) {
                console.error('Error loading cached texture:', error);
                this.showError('Failed to load cached texture');
                this.hideLoading(); // Hide loading on error
            }
        };
        
        img.onerror = () => {
            this.showError('Failed to load cached texture');
            this.hideLoading(); // Hide loading on error
        };
        
        img.src = dataUrl;
    }

    addToUploadHistory(file, img) {
        // Create thumbnail for UI display
        const canvas = document.createElement('canvas');
        canvas.width = 100;
        canvas.height = 50;
        const ctx = canvas.getContext('2d');
        
        // Draw scaled image to canvas
        ctx.drawImage(img, 0, 0, 100, 50);
        const thumbnailUrl = canvas.toDataURL('image/jpeg', 0.8);
        
        // Create upload entry without settings (user will save manually if desired)
        const uploadEntry = {
            id: Date.now() + Math.random(), // Unique ID
            name: file.name.split('.')[0], // Filename without extension
            thumbnailUrl: thumbnailUrl,
            originalDataUrl: img.src, // Keep full quality for IndexedDB
            timestamp: new Date(),
            // No automatic settings saved - user must use "Save Current View" button
            savedSettings: null
        };
        
        // Store reference to current upload for potential saving
        this.currentUploadEntry = uploadEntry;
        
        // Add to history and save to IndexedDB
        this.saveTextureToIndexedDB(uploadEntry);
    }

    updateUploadHistoryUI() {
        const userTexturesGrid = document.getElementById('user-textures');
        const uploadedTexturesGroup = document.getElementById('uploaded-textures-group');
        
        // Clear existing items
        userTexturesGrid.innerHTML = '';
        
        if (this.uploadHistory.length === 0) {
            uploadedTexturesGroup.style.display = 'none';
            return;
        }
        
        // Show section and add items
        uploadedTexturesGroup.style.display = 'block';
        
        this.uploadHistory.forEach(upload => {
            const item = document.createElement('div');
            item.className = 'texture-item';
            item.setAttribute('data-url', upload.originalDataUrl);
            item.title = `${upload.name} (uploaded ${upload.timestamp.toLocaleDateString()})`;
            
            item.innerHTML = `
                <div class="texture-preview" style="background-image: url('${upload.thumbnailUrl}')"></div>
                <span>${upload.name}</span>
            `;
            
            item.addEventListener('click', () => {
                this.loadTextureFromDataUrl(upload.originalDataUrl, upload.savedSettings, upload.name, upload);
            });
            
            userTexturesGrid.appendChild(item);
        });
    }

    initIndexedDB() {
        const request = indexedDB.open('GlobeViewerDB', 1);
        
        request.onerror = () => {
            console.warn('IndexedDB failed to open, falling back to session-only storage');
        };
        
        request.onsuccess = (event) => {
            this.db = event.target.result;
            this.loadUploadHistory();
        };
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            
            // Create object store for textures
            if (!db.objectStoreNames.contains('textures')) {
                const textureStore = db.createObjectStore('textures', { keyPath: 'id' });
                textureStore.createIndex('timestamp', 'timestamp', { unique: false });
            }
        };
    }

    saveTextureToIndexedDB(uploadEntry) {
        if (!this.db) {
            console.warn('IndexedDB not available, texture will only persist for this session');
            this.uploadHistory.unshift(uploadEntry);
            if (this.uploadHistory.length > 10) {
                this.uploadHistory = this.uploadHistory.slice(0, 10);
            }
            this.updateUploadHistoryUI();
            return;
        }

        const transaction = this.db.transaction(['textures'], 'readwrite');
        const store = transaction.objectStore('textures');
        
        // Use put() instead of add() to allow updates to existing records
        store.put(uploadEntry).onsuccess = () => {
            console.log('Texture saved/updated in IndexedDB');
            this.loadUploadHistory(); // Refresh the UI
        };
        
        transaction.onerror = (event) => {
            console.warn('Failed to save texture to IndexedDB:', event.target.error);
        };
    }

    loadUploadHistory() {
        if (!this.db) {
            return; // Will be called again when DB is ready
        }

        const transaction = this.db.transaction(['textures'], 'readonly');
        const store = transaction.objectStore('textures');
        const index = store.index('timestamp');
        
        // Get all textures, sorted by timestamp (newest first)
        const request = index.openCursor(null, 'prev');
        const textures = [];
        
        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                textures.push(cursor.value);
                cursor.continue();
            } else {
                // Limit to 10 most recent
                this.uploadHistory = textures.slice(0, 10);
                // Convert timestamp strings back to Date objects if needed
                this.uploadHistory.forEach(upload => {
                    if (typeof upload.timestamp === 'string') {
                        upload.timestamp = new Date(upload.timestamp);
                    }
                });
                this.updateUploadHistoryUI();
            }
        };
        
        request.onerror = () => {
            console.warn('Failed to load textures from IndexedDB');
        };
    }

    clearUploadHistory() {
        this.uploadHistory = [];
        this.updateUploadHistoryUI();
        
        if (!this.db) return;
        
        const transaction = this.db.transaction(['textures'], 'readwrite');
        const store = transaction.objectStore('textures');
        
        store.clear().onsuccess = () => {
            console.log('Texture history cleared from IndexedDB');
        };
    }

    saveCurrentSettings() {
        if (!this.currentUploadEntry) {
            alert('No uploaded texture to save settings for. Please upload an image first.');
            return;
        }

        // Capture current camera position and rotation
        const cameraSettings = {
            position: {
                x: this.camera.position.x,
                y: this.camera.position.y,
                z: this.camera.position.z
            },
            target: {
                x: this.controls.target.x,
                y: this.controls.target.y,
                z: this.controls.target.z
            }
        };

        // Create complete settings object
        const savedSettings = {
            lighting: {
                ambientBrightness: this.ambientBrightness,
                directionalBrightness: this.directionalBrightness,
                lightRotation: this.lightRotation
            },
            camera: cameraSettings
        };

        // Update the current upload entry
        this.currentUploadEntry.savedSettings = savedSettings;
        
        // Save to IndexedDB
        this.saveTextureToIndexedDB(this.currentUploadEntry);
        
        // Show confirmation
        const button = document.getElementById('save-current-settings');
        const originalText = button.textContent;
        button.textContent = '✓ Saved!';
        button.style.background = '#28a745';
        
        setTimeout(() => {
            button.textContent = originalText;
            button.style.background = '#28a745';
        }, 2000);
    }

    restoreSavedSettings(savedSettings) {
        if (!savedSettings) return;

        // Restore lighting settings
        if (savedSettings.lighting) {
            this.ambientBrightness = savedSettings.lighting.ambientBrightness;
            this.directionalBrightness = savedSettings.lighting.directionalBrightness;
            this.lightRotation = savedSettings.lighting.lightRotation;

            // Update UI sliders to match
            const ambientSlider = document.getElementById('ambient-brightness-slider');
            const ambientValue = document.getElementById('ambient-brightness-value');
            const directionalSlider = document.getElementById('directional-brightness-slider');
            const directionalValue = document.getElementById('directional-brightness-value');
            const lightRotationSlider = document.getElementById('light-rotation-slider');
            const lightRotationValue = document.getElementById('light-rotation-value');
            
            if (ambientSlider) {
                ambientSlider.value = this.ambientBrightness;
                ambientValue.textContent = this.ambientBrightness.toFixed(1);
            }
            
            if (directionalSlider) {
                directionalSlider.value = this.directionalBrightness;
                directionalValue.textContent = this.directionalBrightness.toFixed(1);
            }
            
            if (lightRotationSlider) {
                lightRotationSlider.value = this.lightRotation;
                lightRotationValue.textContent = this.lightRotation + '°';
            }
            
            // Apply the lighting changes
            this.updateLighting();
        }

        // Restore camera position
        if (savedSettings.camera) {
            this.camera.position.set(
                savedSettings.camera.position.x,
                savedSettings.camera.position.y,
                savedSettings.camera.position.z
            );
            
            this.controls.target.set(
                savedSettings.camera.target.x,
                savedSettings.camera.target.y,
                savedSettings.camera.target.z
            );
            
            this.controls.update();
        }
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        
        this.controls.update();
        
        // Update lighting to follow camera position
        this.updateLighting();
        
        this.renderer.render(this.scene, this.camera);
    }

    setupUIElements() {
        this.loadingOverlay = document.getElementById('loading-overlay');
        this.dragModal = document.getElementById('drag-modal');
    }

    showLoading(text = 'Loading texture...') {
        if (this.loadingOverlay) {
            const loadingText = this.loadingOverlay.querySelector('.loading-text');
            if (loadingText) {
                loadingText.textContent = text;
            }
            this.loadingOverlay.classList.remove('hidden');
            this.loadingOverlay.classList.add('visible');
        }
    }

    hideLoading() {
        if (this.loadingOverlay) {
            this.loadingOverlay.classList.remove('visible');
            this.loadingOverlay.classList.add('hidden');
        }
    }

    showDragModal() {
        if (this.dragModal) {
            this.dragModal.classList.add('visible');
        }
    }

    hideDragModal() {
        if (this.dragModal) {
            this.dragModal.classList.remove('visible');
        }
    }

    startupSequence() {
        // Show initial loading message
        this.showLoading('Initializing Globe Viewer...');
        
        // Wait for initial render and texture load, then animate
        setTimeout(() => {
            // Update loading message
            this.showLoading('Loading Earth texture...');
            
            // Wait a bit more for texture to fully load
            setTimeout(() => {
                // Hide loading overlay first
                this.hideLoading();
                
                // Start the sphere scale animation after loading fades
                setTimeout(() => {
                    this.animateSphereIn();
                }, 300); // Small delay for loading fade transition
                
            }, 500); // Small delay to ensure texture is loaded
        }, 300); // Small initial delay
    }

    animateSphereIn() {
        if (this.globe) {
            // Use Three.js animation instead of CSS for better control
            const startTime = performance.now();
            const duration = 1200; // 1.2 seconds
            
            const animate = (currentTime) => {
                const elapsed = currentTime - startTime;
                const progress = Math.min(elapsed / duration, 1);
                
                // Cubic bezier easing (0.34, 1.56, 0.64, 1) - bouncy effect
                const easedProgress = this.easeOutBack(progress);
                
                this.globe.scale.setScalar(easedProgress);
                
                if (progress < 1) {
                    requestAnimationFrame(animate);
                }
            };
            
            requestAnimationFrame(animate);
        }
    }

    // Easing function for bouncy effect
    easeOutBack(t) {
        const c1 = 1.70158;
        const c3 = c1 + 1;
        return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    }
}

// Initialize the globe viewer when the page loads
new GlobeViewer();