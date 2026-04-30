// Globe renderer using Three.js - lightweight, no React
(function() {
    const container = document.getElementById('globeContainer');
    if (!container || typeof THREE === 'undefined') return;

    const W = container.clientWidth || 400;
    const H = container.clientHeight || 400;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 100);
    camera.position.z = 2.8;

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    // Earth sphere with wireframe
    const geo = new THREE.SphereGeometry(1, 48, 48);
    
    // Solid dark sphere
    const solidMat = new THREE.MeshBasicMaterial({ color: 0x0a0e14 });
    const solidSphere = new THREE.Mesh(geo, solidMat);
    scene.add(solidSphere);

    // Wireframe overlay
    const wireMat = new THREE.MeshBasicMaterial({
        color: 0x00ff41,
        wireframe: true,
        transparent: true,
        opacity: 0.08
    });
    const wireSphere = new THREE.Mesh(geo, wireMat);
    scene.add(wireSphere);

    // Outer glow ring
    const ringGeo = new THREE.RingGeometry(1.15, 1.18, 64);
    const ringMat = new THREE.MeshBasicMaterial({
        color: 0x00ff41,
        transparent: true,
        opacity: 0.2,
        side: THREE.DoubleSide
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    scene.add(ring);

    // Grid lines (latitude/longitude)
    const gridMat = new THREE.LineBasicMaterial({ color: 0x00ff41, transparent: true, opacity: 0.15 });
    
    // Latitude lines
    for (let lat = -60; lat <= 60; lat += 30) {
        const rad = Math.cos(lat * Math.PI / 180);
        const y = Math.sin(lat * Math.PI / 180);
        const pts = [];
        for (let i = 0; i <= 64; i++) {
            const a = (i / 64) * Math.PI * 2;
            pts.push(new THREE.Vector3(Math.cos(a) * rad, y, Math.sin(a) * rad));
        }
        const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
        scene.add(new THREE.Line(lineGeo, gridMat));
    }
    
    // Longitude lines
    for (let lon = 0; lon < 360; lon += 30) {
        const pts = [];
        for (let i = 0; i <= 64; i++) {
            const lat = (i / 64) * Math.PI - Math.PI / 2;
            const a = lon * Math.PI / 180;
            pts.push(new THREE.Vector3(
                Math.cos(lat) * Math.cos(a),
                Math.sin(lat),
                Math.cos(lat) * Math.sin(a)
            ));
        }
        const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
        scene.add(new THREE.Line(lineGeo, gridMat));
    }

    // Location marker (will be positioned when data arrives)
    const markerGroup = new THREE.Group();
    
    // Dot
    const dotGeo = new THREE.SphereGeometry(0.03, 16, 16);
    const dotMat = new THREE.MeshBasicMaterial({ color: 0xff2d4a });
    const dot = new THREE.Mesh(dotGeo, dotMat);
    markerGroup.add(dot);

    // Pulse ring
    const pulseGeo = new THREE.RingGeometry(0.04, 0.06, 32);
    const pulseMat = new THREE.MeshBasicMaterial({
        color: 0xff2d4a,
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide
    });
    const pulse = new THREE.Mesh(pulseGeo, pulseMat);
    markerGroup.add(pulse);

    scene.add(markerGroup);
    markerGroup.visible = false;

    // Convert lat/lon to 3D position on sphere
    function latLonToVec3(lat, lon, radius) {
        const phi = (90 - lat) * Math.PI / 180;
        const theta = (lon + 180) * Math.PI / 180;
        return new THREE.Vector3(
            -radius * Math.sin(phi) * Math.cos(theta),
            radius * Math.cos(phi),
            radius * Math.sin(phi) * Math.sin(theta)
        );
    }

    // Public method to set location
    window.setGlobeLocation = function(lat, lon) {
        const pos = latLonToVec3(lat, lon, 1.02);
        markerGroup.position.copy(pos);
        markerGroup.lookAt(0, 0, 0);
        markerGroup.visible = true;
        
        // Rotate globe to show the location
        const targetRot = -lon * Math.PI / 180 - Math.PI / 2;
        // Smooth rotate
        const startRot = solidSphere.rotation.y;
        const startTime = Date.now();
        function animateRotation() {
            const t = Math.min((Date.now() - startTime) / 1500, 1);
            const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
            solidSphere.rotation.y = startRot + (targetRot - startRot) * ease;
            wireSphere.rotation.y = solidSphere.rotation.y;
            if (t < 1) requestAnimationFrame(animateRotation);
        }
        animateRotation();
    };

    // Ambient light
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));

    // Particles (stars)
    const starsGeo = new THREE.BufferGeometry();
    const starPositions = [];
    for (let i = 0; i < 200; i++) {
        starPositions.push(
            (Math.random() - 0.5) * 10,
            (Math.random() - 0.5) * 10,
            (Math.random() - 0.5) * 10
        );
    }
    starsGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
    const starsMat = new THREE.PointsMaterial({ color: 0x00ff41, size: 0.02, transparent: true, opacity: 0.4 });
    scene.add(new THREE.Points(starsGeo, starsMat));

    // Animation
    let pulseScale = 1;
    let pulseDir = 1;
    function animate() {
        requestAnimationFrame(animate);
        solidSphere.rotation.y += 0.002;
        wireSphere.rotation.y += 0.002;
        
        // Pulse effect on marker
        if (markerGroup.visible) {
            pulseScale += 0.02 * pulseDir;
            if (pulseScale > 2) pulseDir = -1;
            if (pulseScale < 1) pulseDir = 1;
            pulse.scale.set(pulseScale, pulseScale, 1);
            pulseMat.opacity = 0.6 / pulseScale;
        }
        
        renderer.render(scene, camera);
    }
    animate();

    // Resize
    window.addEventListener('resize', () => {
        const w = container.clientWidth;
        const h = container.clientHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
    });
})();
