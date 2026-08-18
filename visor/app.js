import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
// GLTFLoader se usa para la malla GLB del modelo publicado en GitHub Pages
// (ver generador/web_bundle.py); OBJLoader sigue atendiendo al visor local.
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Inicialización de la escena, cámara y renderizador
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
scene.background = null; // Fondo transparente para usar gradiente CSS
// Sin niebla: el OBJ usa coordenadas en metros reales (pueden ser decenas
// de miles de unidades en cartas grandes) y una densidad de niebla fija
// calibrada para la escala antigua (índices de píxel, cientos de unidades)
// saturaba toda la escena a blanco casi de inmediato, dejando el modelo
// invisible sin importar la cámara.

// far=1e7: el plano de recorte lejano por defecto de three.js (o cualquier
// valor pequeño tipo 10000) recorta geometría real de decenas/cientos de
// miles de metros en cartas grandes — el terreno quedaba fuera del volumen
// de vista y no se dibujaba nada. Se ajusta de nuevo al tamaño real del
// modelo una vez cargado (ver loadModel).
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1e7);
// Posición inicial de la cámara (se ajustará al cargar el modelo)
camera.position.set(0, 100, 200);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
// Tope de 2x: en celulares con pantallas de muy alta densidad (devicePixelRatio
// 3 o más en varios Android/iPhone recientes) renderizar a la densidad nativa
// completa duplica o triplica los píxeles a dibujar en una GPU móvil bastante
// más débil que una de escritorio, para un modelo que además puede tener
// cientos de miles de vértices — el frame rate cae notoriamente sin que se
// note diferencia visual real por encima de 2x.
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);

// Evita el menú contextual de "guardar imagen"/selección que Android/iOS
// muestran ante una pulsación larga sobre el canvas (interfiere con el gesto
// de orbitar/zoom táctil).
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

// Controles de Órbita (sin restricciones de movimiento)
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.screenSpacePanning = true;
controls.zoomToCursor = true; // El zoom del mouse apunta hacia donde está el cursor

// Doble clic para centrar suavemente la cámara y el zoom en cualquier zona del mapa (ej. Zona Norte)
const raycaster = new THREE.Raycaster();
const mouseVec = new THREE.Vector2();

renderer.domElement.addEventListener('dblclick', (event) => {
    const rect = renderer.domElement.getBoundingClientRect();
    mouseVec.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouseVec.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouseVec, camera);
    const intersects = raycaster.intersectObjects(scene.children, true);

    if (intersects.length > 0) {
        const targetPoint = intersects[0].point;
        const startTarget = controls.target.clone();
        const startCam = camera.position.clone();
        const camOffset = startCam.clone().sub(startTarget);
        
        let progress = 0;
        function animateFocus() {
            progress += 0.08;
            if (progress > 1) progress = 1;

            controls.target.lerpVectors(startTarget, targetPoint, progress);
            camera.position.set(
                controls.target.x + camOffset.x * 0.6,
                controls.target.y + camOffset.y * 0.6,
                controls.target.z + camOffset.z * 0.6
            );
            controls.update();

            if (progress < 1) {
                requestAnimationFrame(animateFocus);
            }
        }
        animateFocus();
    }
});

// Iluminación
const ambientLight = new THREE.AmbientLight(0x404040, 1.5); // Luz suave
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 2);
directionalLight.position.set(1, 1, 1).normalize();
scene.add(directionalLight);

const directionalLight2 = new THREE.DirectionalLight(0xaaaaee, 1);
directionalLight2.position.set(-1, 0.5, -1).normalize();
scene.add(directionalLight2);

// Rampa de color hipsométrica (color por altura): azul/verde en las zonas
// bajas, pasando por amarillo/ocre y marrón en las medias, hasta blanco en
// las cumbres. `t` es la elevación normalizada 0..1 dentro del modelo.
const ELEVATION_COLOR_STOPS = [
    [0.00, [0.10, 0.30, 0.55]], // azul (nivel del mar / zonas bajas)
    [0.15, [0.13, 0.50, 0.28]], // verde oscuro
    [0.35, [0.45, 0.62, 0.25]], // verde claro
    [0.55, [0.80, 0.72, 0.35]], // amarillo/ocre
    [0.75, [0.62, 0.42, 0.25]], // marrón
    [0.90, [0.55, 0.38, 0.34]], // marrón rojizo
    [1.00, [1.00, 1.00, 1.00]], // blanco (cumbres)
];

function elevationToColor(t) {
    t = Math.min(1, Math.max(0, t));
    for (let i = 0; i < ELEVATION_COLOR_STOPS.length - 1; i++) {
        const [t0, c0] = ELEVATION_COLOR_STOPS[i];
        const [t1, c1] = ELEVATION_COLOR_STOPS[i + 1];
        if (t <= t1) {
            const f = (t - t0) / (t1 - t0 || 1);
            return [
                c0[0] + (c1[0] - c0[0]) * f,
                c0[1] + (c1[1] - c0[1]) * f,
                c0[2] + (c1[2] - c0[2]) * f,
            ];
        }
    }
    return ELEVATION_COLOR_STOPS[ELEVATION_COLOR_STOPS.length - 1][1];
}

function applyElevationColors(mesh) {
    const geometry = mesh.geometry;
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    const zMin = geometry.boundingBox.min.z;
    const zMax = geometry.boundingBox.max.z;
    const range = zMax - zMin;

    const position = geometry.attributes.position;
    const colors = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i++) {
        const t = range > 1e-6 ? (position.getZ(i) - zMin) / range : 0;
        const [r, g, b] = elevationToColor(t);
        colors[i * 3] = r;
        colors[i * 3 + 1] = g;
        colors[i * 3 + 2] = b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

// Obtener ID del modelo y su carpeta desde la URL
const urlParams = new URLSearchParams(window.location.search);
const modelId = urlParams.get('id');
const modelDir = urlParams.get('dir') || 'generador/salida';
const modelName = urlParams.get('nombre');

const loadingElement = document.getElementById('loading');
const infoElement = document.getElementById('model-info');

// Estado compartido con la barra de herramientas (botones de reset / textura
// / pantalla completa, ver más abajo): se llena una vez cargado el modelo.
const viewerState = {
    material: null,
    satelliteTexture: null, // null hasta que se sepa si la textura cargó o no
    usingTexture: false,
    defaultCamera: null, // { position, up, target } para "Restablecer vista"
    contours: null,      // { minor, main } una vez cargadas las curvas de nivel
    // 0 = todas, 1 = solo maestras, 2 = ninguna. Arranca en "solo maestras":
    // con el intervalo secundario de una carta 1:25.000 las curvas se cuentan
    // por miles y, aunque cada línea sea tenue, al superponerse tapaban la foto
    // satelital -- y no se pueden dibujar más finas de un píxel (ver el
    // comentario de los materiales en addContourLines3D). Las maestras solas
    // mantienen la lectura del relieve dejando ver el terreno; el botón de la
    // barra permite volver a todas de un toque.
    contourMode: 1,
};

if (!modelId) {
    loadingElement.style.display = 'none';
    infoElement.innerHTML = '<span style="color:red;">Error: No se especificó ID de modelo en la URL.</span>';
} else {
    if (modelName) {
        setViewerTitle(modelName);
    }
    infoElement.textContent = `Cargando ID: ${modelId}...`;
    loadModelInfo(modelId, modelDir);
    loadModel(modelId, modelDir);
}

function setViewerTitle(name) {
    document.querySelector('#ui-header h1').textContent = `Visor Topográfico 3D - ${name.toUpperCase()}`;
}

function loadModelInfo(id, dir) {
    // Ficha del modelo publicada junto a la malla (ver build_bundle en
    // generador/web_bundle.py). Trae el nombre de la carta y su rango de
    // elevación real, datos que el QR ya no necesita llevar en la URL: cada
    // carácter de más obliga al código QR a usar una versión con más módulos y
    // lo vuelve más denso de escanear impreso.
    fetch(`../${dir}/modelo_${id}.json`)
        .then((res) => (res.ok ? res.json() : null))
        .then((info) => {
            if (!info) return;
            if (info.nombre && !modelName) setViewerTitle(info.nombre);
            if (info.elevacion_min_m != null && info.elevacion_max_m != null) {
                const min = Math.round(info.elevacion_min_m);
                const max = Math.round(info.elevacion_max_m);
                const escala = info.escala ? ` &middot; Escala 1:${info.escala}` : '';
                document.getElementById('model-extra').innerHTML =
                    `Elevación: ${min} a ${max} m s.n.m.${escala}`;
            }
        })
        .catch(() => {}); // el visor local no publica esta ficha: no es un error
}

function addContourLines3D(object, dir, id, recomputeUV = true) {
    // Curvas de nivel en 3D (generadas por generate_contour_lines_3d en
    // map_generator.py) con la misma escala/exageración y el mismo
    // smooth_sigma que la malla del terreno, para que se vean "apoyadas"
    // sobre el relieve real en vez de quedar en un plano aparte como en la
    // imagen 2D del anaglifo.
    const curvesUrl = `../${dir}/curvas_${id}.json`;

    fetch(curvesUrl)
        .then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json();
        })
        .then((data) => {
            const contourGroup = new THREE.Group();
            // Un grupo por tipo de curva para poder atenuarlas u ocultarlas de
            // forma independiente desde la barra de herramientas.
            const minorGroup = new THREE.Group();
            const mainGroup = new THREE.Group();
            contourGroup.add(minorGroup);
            contourGroup.add(mainGroup);

            // El anaglifo 2D usa alpha_minor=0.6 / alpha_main=0.9
            // (overlay_contours en contours.py), pero aquí van bastante más
            // tenues a propósito: sobre la foto satelital del modelo 3D esas
            // opacidades tapaban el terreno. No se pueden dibujar más finas --
            // WebGL ignora `linewidth` en LineBasicMaterial y todas las líneas
            // miden un píxel, así que el único margen real para bajarles peso
            // visual es la opacidad (y reducir cuántas se muestran, ver el
            // botón de curvas en la barra de herramientas). Se mantiene la
            // jerarquía maestra/secundaria por contraste, igual que en el 2D.
            const minorMaterial = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25 });
            const mainMaterial = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 });

            const buildLines = (polylines, material, group) => {
                (polylines || []).forEach((pts) => {
                    if (pts.length < 2) return;
                    const positions = new Float32Array(pts.length * 3);
                    for (let i = 0; i < pts.length; i++) {
                        positions[i * 3] = pts[i][0];
                        positions[i * 3 + 1] = pts[i][1];
                        positions[i * 3 + 2] = pts[i][2];
                    }
                    const geometry = new THREE.BufferGeometry();
                    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
                    group.add(new THREE.Line(geometry, material));
                });
            };

            buildLines(data.minor, minorMaterial, minorGroup);
            buildLines(data.main, mainMaterial, mainGroup);

            // Referencias para el botón de curvas (ver updateContourState).
            viewerState.contours = { minor: minorGroup, main: mainGroup };
            applyContourMode();

            // Se agrega como hijo del objeto del terreno: hereda
            // automáticamente su misma rotación (Z de elevación -> Y) y su
            // traslación de centrado, sin duplicar esa lógica aquí.
            object.add(contourGroup);
            
            // Re-calcular los UVs del terreno con el bounding box real del DEM 
            // completo, si viene en el JSON. Esto corrige el desfase de la textura
            // cuando la geometría del OBJ fue recortada en los bordes por falta de cobertura.
            if (recomputeUV && data.bbox) {
                object.traverse((child) => {
                    if (child.isMesh && child.geometry) {
                        computeGridUV(child.geometry, data.bbox);
                    }
                });
            }
        })
        .catch((err) => console.warn('No se pudieron cargar las curvas de nivel 3D:', err));
}

function computeGridUV(geometry, realBbox) {
    // Calcula un atributo 'uv' a partir de la posición x/y de cada vértice.
    // Si realBbox está definido, usa las dimensiones originales del DEM completo,
    // evitando que recortes en los bordes deformen y desfasen la textura.
    let minX, maxX, minY, maxY;
    if (realBbox) {
        minX = realBbox.min_x;
        maxX = realBbox.max_x;
        minY = realBbox.min_y;
        maxY = realBbox.max_y;
    } else {
        geometry.computeBoundingBox();
        const bbox = geometry.boundingBox;
        minX = bbox.min.x;
        maxX = bbox.max.x;
        minY = bbox.min.y;
        maxY = bbox.max.y;
    }
    const dx = (maxX - minX) || 1;
    const dy = (maxY - minY) || 1;
    const position = geometry.attributes.position;
    const uv = new Float32Array(position.count * 2);
    for (let i = 0; i < position.count; i++) {
        const u = (position.getX(i) - minX) / dx;
        // y crece hacia el sur (fila del DEM); v=1 debe caer en el norte
        // (fila 0, y mínimo) para calzar con el borde superior de la
        // textura (three.js usa flipY=true por defecto al cargar imágenes).
        const v = 1 - (position.getY(i) - minY) / dy;
        uv[i * 2] = u;
        uv[i * 2 + 1] = v;
    }
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

function loadSatelliteTexture(textureUrl) {
    const textureLoader = new THREE.TextureLoader();
    const texturePromise = new Promise((resolve) => {
        textureLoader.load(
            textureUrl,
            (tex) => {
                if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
                resolve(tex);
            },
            undefined,
            (err) => {
                console.warn('No se pudo cargar la textura satelital, usando color por altura:', err);
                resolve(null);
            }
        );
    });
    return texturePromise;
}

function probeUrl(url) {
    // HEAD en vez de GET: solo interesa saber si el archivo existe, sin
    // descargar los megabytes de la malla para averiguarlo. Tanto GitHub Pages
    // como el servidor local de la app (SimpleHTTPRequestHandler) responden HEAD.
    return fetch(url, { method: 'HEAD' })
        .then((res) => res.ok)
        .catch(() => false);
}

// Reintentos mientras GitHub Pages termina de construir el sitio. Subir los
// archivos y que la URL responda son dos cosas distintas: hasta que la
// compilación acaba, la malla da 404 aunque ya esté publicada. Antes eso se veía
// como un error definitivo -- el QR recién impreso "no funcionaba" y solo cabía
// recargar a ciegas. Ahora el visor lo detecta y espera solo.
const REINTENTOS_PUBLICACION = 12;
const ESPERA_REINTENTO_MS = 5000;

function loadModel(id, dir) {
    // `dir` es la ruta (relativa a la raíz servida) de la carpeta donde viven
    // los productos de esta carta/área (ver parámetro `dir` en la URL, que
    // agregan main_app.py para el visor local y github_pages.py para el
    // modelo publicado).
    const glbUrl = `../${dir}/modelo_${id}.glb`;
    const objUrl = `../${dir}/modelo_${id}.obj`;
    const textureUrl = `../${dir}/textura_${id}.jpg`;

    // Dos formatos de malla para dos escenarios distintos:
    //
    //   * GLB (glTF binario, con la textura satelital incrustada): es lo que se
    //     publica en GitHub Pages para que el QR impreso en la carta funcione
    //     desde cualquier red y sin depender del computador que lo generó. Pesa
    //     del orden de 3 MB frente a los ~85 MB del OBJ + ~20 MB de textura,
    //     que es lo que hace viable abrirlo con datos móviles.
    //   * OBJ + textura JPG aparte: lo que sirve el visor local de la app, con
    //     la malla a resolución completa.
    //
    // Se prueba primero el GLB y se cae al OBJ si no está, así el mismo visor
    // sirve en los dos casos sin bifurcar la URL del QR.
    const intentar = (intento) => {
        Promise.all([probeUrl(glbUrl), probeUrl(objUrl)]).then(([hasGlb, hasObj]) => {
            if (hasGlb) {
                new GLTFLoader().load(
                    glbUrl,
                    (gltf) => onModelLoaded(gltf.scene, id, dir, null),
                    onModelProgress,
                    onModelError
                );
                return;
            }
            if (hasObj) {
                const texturePromise = loadSatelliteTexture(textureUrl);
                new OBJLoader().load(
                    objUrl,
                    (object) => onModelLoaded(object, id, dir, texturePromise),
                    onModelProgress,
                    onModelError
                );
                return;
            }
            // Ningún formato disponible. Si el sitio acaba de publicarse, es
            // cuestión de esperar; se distingue de un error real reintentando un
            // rato antes de rendirse, e informando de la causa probable en vez
            // del mensaje genérico anterior.
            if (intento < REINTENTOS_PUBLICACION) {
                const restante = (REINTENTOS_PUBLICACION - intento) * (ESPERA_REINTENTO_MS / 1000);
                loadingElement.textContent = 'Publicando el modelo, espere...';
                infoElement.innerHTML =
                    'El modelo todavía no está disponible en el servidor.<br>' +
                    'Si la carta se acaba de generar, GitHub Pages aún está construyendo el sitio.<br>' +
                    `Reintentando automáticamente (quedan ${Math.round(restante)} s).`;
                setTimeout(() => intentar(intento + 1), ESPERA_REINTENTO_MS);
                return;
            }
            loadingElement.style.display = 'none';
            infoElement.innerHTML =
                '<span style="color:#ffcc00;">No se encontró el modelo con ID ' + id + '.</span><br>' +
                'Verifique que el enlace del QR sea correcto y que la carta haya terminado de publicarse.';
        });
    };
    intentar(0);
}

function onModelLoaded(object, id, dir, texturePromise) {
    // texturePromise === null identifica la ruta GLB: ahí la textura satelital
    // y las coordenadas UV vienen dentro del propio archivo, así que no hay
    // imagen aparte que esperar ni UV que deducir desde la posición.
    const isGlb = texturePromise === null;

    // El GLB anida la malla en un nodo hijo de la escena, el OBJ la deja como
    // hijo directo del grupo: traverse cubre los dos casos.
    const boundingBox = new THREE.Box3();
    const meshes = [];
    object.traverse((child) => {
        if (child.isMesh) meshes.push(child);
    });

    let material;
    if (isGlb) {
        // Se reutiliza el material que trae el GLB (ya con la foto satelital
        // como `map`) en vez de crear uno nuevo, que descartaría la textura
        // incrustada.
        material = meshes.length ? meshes[0].material : null;
        if (material) {
            material.side = THREE.DoubleSide;
            material.vertexColors = false;
        }
        meshes.forEach((mesh) => {
            // Igual que en la ruta OBJ, el color por altura se calcula siempre
            // para que el botón "🛰" pueda alternar textura/hipsometría al
            // instante. computeVertexNormals (dentro de applyElevationColors)
            // además es necesario porque el GLB no exporta normales.
            applyElevationColors(mesh);
            if (material) mesh.material = material;
        });
        viewerState.material = material;
        viewerState.satelliteTexture = material ? material.map : null;
        viewerState.usingTexture = !!(material && material.map);
        updateToolbarState();
    } else {
        material = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            vertexColors: false,
            wireframe: false,
            roughness: 0.9,
            metalness: 0.0,
            side: THREE.DoubleSide
        });

        meshes.forEach((mesh) => {
            computeGridUV(mesh.geometry);
            applyElevationColors(mesh);
            mesh.material = material;
        });
        viewerState.material = material;

        texturePromise.then((tex) => {
            viewerState.satelliteTexture = tex;
            if (tex) {
                material.map = tex;
                material.vertexColors = false;
                viewerState.usingTexture = true;
            } else {
                // Respaldo: si la textura satelital no cargó, se
                // mantiene la lectura hipsométrica anterior en vez de
                // dejar el terreno en blanco liso, y se deshabilita el
                // botón de textura (no hay a qué alternar). El
                // wireframe superpuesto (bordes de las celdas del DEM)
                // solo tiene sentido como referencia "técnica" sobre
                // ese color plano por altura; con la foto satelital real
                // se vería como una grilla de píxeles indeseada, así que
                // no se agrega en el caso normal (textura exitosa).
                material.vertexColors = true;
                viewerState.usingTexture = false;
                const wireframeMaterial = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.1 });
                meshes.forEach((mesh) => {
                    const edges = new THREE.EdgesGeometry(mesh.geometry);
                    mesh.add(new THREE.LineSegments(edges, wireframeMaterial));
                });
            }
            material.needsUpdate = true;
            updateToolbarState();
        });
    }

    // El OBJ exportado usa (x, y) horizontales en metros y z =
    // elevación (ver generate_obj_model en map_generator.py), pero
    // three.js/OrbitControls asumen por convención que Y es
    // "arriba". Sin este giro, la altura queda en el eje de
    // profundidad de la cámara en vez de la vertical de pantalla:
    // el terreno se ve como un plano sin relieve visible sin
    // importar el ángulo de cámara. Se rota -90° en X para que la
    // elevación pase a ser el eje Y (vertical real de la escena).
    object.rotation.x = -Math.PI / 2;

    // Espejo Este-Oeste: x_local crece hacia el Este y, tras la
    // rotación de arriba, ese eje X se preserva tal cual en el
    // mundo. Mirar el plano del terreno desde ARRIBA con una cámara
    // en el eje +Y (three.js/OrbitControls, sistema de mano
    // derecha) invierte la lateralidad de ese plano igual que un
    // espejo -- se verificó numéricamente (cross-product de la
    // base de cámara) que sin este `scale.x = -1` no existe ningún
    // vector "up" de cámara que deje el Norte arriba en pantalla Y
    // el Este a la derecha al mismo tiempo (uno de los dos queda
    // invertido). Con este espejo, camera.up=(0,0,1) (ver más abajo)
    // sí da ambos correctos. `side: THREE.DoubleSide` en el
    // material evita que la reversión de winding que produce este
    // espejo se vea como caras "al revés" sin iluminar.
    object.scale.x = -1;

    // Centrar el objeto en la escena (bounding box recalculado
    // DESPUÉS de rotar, porque el alto real ahora vive en Y)
    boundingBox.setFromObject(object);
    const center = boundingBox.getCenter(new THREE.Vector3());
    const size = boundingBox.getSize(new THREE.Vector3());

    // Resguardo: si el bounding box saliera degenerado (NaN o
    // tamaño cero, p.ej. por un modelo vacío/corrupto), no seguir
    // con una cámara/posición inválida que deje el modelo invisible
    // o "perdido" en cualquier parte de la escena.
    const isFinite3 = (v) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
    if (!isFinite3(center) || !isFinite3(size)) {
        console.error('Bounding box inválido del modelo cargado:', center, size);
        infoElement.innerHTML = '<span style="color:red;">Error: geometría del modelo inválida.</span>';
        return;
    }

    object.position.x += (object.position.x - center.x);
    object.position.y += (object.position.y - center.y);
    object.position.z += (object.position.z - center.z);

    scene.add(object);
    // Solo la ruta OBJ necesita recalcular los UV con el bounding box real del
    // DEM que viene en el JSON de curvas: el GLB ya trae los UV correctos
    // calculados sobre la extensión completa de la grilla (ver
    // generate_glb_model en mesh3d.py), y sobrescribirlos desfasaría la foto.
    addContourLines3D(object, dir, id, !isGlb);

    // Vista ortogonal FIJA: siempre mirando derecho hacia abajo
    // (perpendicular al terreno), desde la misma dirección y
    // distancia relativa sin importar el tamaño/forma de la carta.
    // Antes la vista 3/4 se calculaba con la misma fórmula pero
    // terminaba muy distinta de un modelo a otro (algunos quedaban
    // fuera de cuadro o con un encuadre que hacía parecer que el
    // modelo "se perdía"); esta vista es reproducible y perpendicular
    // al espacio geográfico como se pidió, y desde ahí el usuario
    // puede orbitar libremente con el mouse para inclinarla.
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const cameraDist = Math.max(maxDim * 1.6, 10);

    // Posición de cámara hacia el Norte: ubicada al Sur (-Z) orientada hacia
    // el Norte (+Z), con elevación en perspectiva 3D a 45° sin singularidades.
    camera.position.set(0, cameraDist * 0.75, -cameraDist * 0.75);
    camera.up.set(0, 1, 0);

    camera.far = Math.max(cameraDist * 10, 1000);
    camera.updateProjectionMatrix();
    camera.lookAt(0, 0, 0);
    controls.target.set(0, 0, 0);
    controls.update();

    // Guardado para el botón "Restablecer vista" de la barra de
    // herramientas: en un celular es fácil perder el encuadre
    // orbitando con el dedo, así que conviene poder volver aquí con
    // un toque en vez de tener que recargar la página.
    viewerState.defaultCamera = {
        position: camera.position.clone(),
        up: camera.up.clone(),
        target: controls.target.clone(),
    };
    loadingElement.style.display = 'none';
    infoElement.innerHTML = `Modelo Cargado.<br>ID: ${id}`;
}

function onModelProgress(xhr) {
    const percent = (xhr.loaded / xhr.total * 100);
    if (isFinite(percent)) {
        loadingElement.textContent = `Cargando... ${Math.round(percent)}%`;
    } else {
        loadingElement.textContent = `Cargando... ${(xhr.loaded / 1024 / 1024).toFixed(2)} MB`;
    }
    }

function onModelError(error) {
    // Aquí solo se llega cuando el archivo SÍ existe (ya lo confirmó el sondeo
    // previo) pero no se pudo leer: descarga interrumpida o malla corrupta. El
    // caso "todavía no publicado" se trata aparte, en loadModel, porque su
    // solución es esperar y no tiene nada que ver con un archivo dañado.
    console.error('Error al cargar el modelo:', error);
    loadingElement.style.display = 'none';
    infoElement.innerHTML =
        '<span style="color:red;">No se pudo leer el modelo 3D.</span><br>' +
        'El archivo existe pero la descarga falló o llegó dañada. Reintente recargando la página.';
}

// Redimensionamiento de la ventana (incluye el giro de pantalla en
// celulares: 'orientationchange' dispara antes de que innerWidth/innerHeight
// terminen de actualizarse en algunos navegadores móviles, por eso además
// del evento normal se agrega un pequeño retraso).
window.addEventListener('resize', onWindowResize, false);
window.addEventListener('orientationchange', () => setTimeout(onWindowResize, 200));
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// --- Barra de herramientas (pensada para uso en celular) ---

const btnReset = document.getElementById('btn-reset');
const btnTexture = document.getElementById('btn-texture');
const btnFullscreen = document.getElementById('btn-fullscreen');

btnReset.addEventListener('click', () => {
    if (!viewerState.defaultCamera) return;
    const { position, up, target } = viewerState.defaultCamera;
    camera.position.copy(position);
    camera.up.copy(up);
    controls.target.copy(target);
    camera.lookAt(target);
    controls.update();
});

btnTexture.addEventListener('click', () => {
    const { material, satelliteTexture } = viewerState;
    if (!material || !satelliteTexture) return; // nada a lo que alternar
    viewerState.usingTexture = !viewerState.usingTexture;
    material.map = viewerState.usingTexture ? satelliteTexture : null;
    material.vertexColors = !viewerState.usingTexture;
    material.needsUpdate = true;
    updateToolbarState();
});

const btnContours = document.getElementById('btn-contours');

const CONTOUR_MODES = [
    { minor: true, main: true, icono: '〰', etiqueta: 'Curvas: todas' },
    { minor: false, main: true, icono: '≈', etiqueta: 'Curvas: solo maestras' },
    { minor: false, main: false, icono: '⃠', etiqueta: 'Curvas: ninguna' },
];

function applyContourMode() {
    const modo = CONTOUR_MODES[viewerState.contourMode];
    if (viewerState.contours) {
        viewerState.contours.minor.visible = modo.minor;
        viewerState.contours.main.visible = modo.main;
    }
    btnContours.textContent = modo.icono;
    btnContours.title = modo.etiqueta;
    btnContours.setAttribute('aria-label', modo.etiqueta);
    btnContours.classList.toggle('active', modo.minor || modo.main);
    // Sin curvas cargadas todavía no hay nada que alternar.
    btnContours.disabled = !viewerState.contours;
}

btnContours.addEventListener('click', () => {
    viewerState.contourMode = (viewerState.contourMode + 1) % CONTOUR_MODES.length;
    applyContourMode();
});

btnFullscreen.addEventListener('click', () => {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
        document.exitFullscreen?.();
    }
});
document.addEventListener('fullscreenchange', () => {
    btnFullscreen.classList.toggle('active', !!document.fullscreenElement);
    btnFullscreen.textContent = document.fullscreenElement ? '✕' : '⛶';
});

function updateToolbarState() {
    // Sin textura satelital (falló la descarga), no hay nada que alternar:
    // se deshabilita el botón en vez de dejarlo sin efecto visible.
    btnTexture.disabled = !viewerState.satelliteTexture;
    btnTexture.classList.toggle('active', viewerState.usingTexture);
    btnTexture.textContent = viewerState.usingTexture ? '🛰' : '⛰';
}
updateToolbarState();
applyContourMode();

// Panel de información: colapsable con un toque, para no tapar el modelo en
// pantallas de celular sostenidas en vertical.
const uiContainer = document.getElementById('ui-container');
const uiHeader = document.getElementById('ui-header');
const uiToggle = document.getElementById('ui-toggle');
uiHeader.addEventListener('click', () => {
    const collapsed = uiContainer.classList.toggle('collapsed');
    uiToggle.textContent = collapsed ? '▼' : '▲';
});

// --- Brújula de Orientación (Axes Helper) ---
const axesContainer = document.getElementById('axes-container');
const axesScene = new THREE.Scene();
const axesCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 10);
axesCamera.position.set(0, 0, 4);

const axesRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
axesRenderer.setSize(100, 100);
axesContainer.appendChild(axesRenderer.domElement);

// Flechas llamativas: Este (X), Elevación (Y), Norte (-Z)
const arrowDirE = new THREE.Vector3(1, 0, 0);
const arrowDirN = new THREE.Vector3(0, 0, -1);
const arrowDirZ = new THREE.Vector3(0, 1, 0);
const origin = new THREE.Vector3(0, 0, 0);
const arrowLength = 1.2;
const headLength = 0.4;
const headWidth = 0.25;

axesScene.add(new THREE.ArrowHelper(arrowDirE, origin, arrowLength, 0xff3333, headLength, headWidth));
axesScene.add(new THREE.ArrowHelper(arrowDirN, origin, arrowLength, 0x33ff33, headLength, headWidth));
axesScene.add(new THREE.ArrowHelper(arrowDirZ, origin, arrowLength, 0x3388ff, headLength, headWidth));

// Etiquetas HTML flotantes para los ejes
function createAxisLabel(text, color) {
    const div = document.createElement('div');
    div.className = 'axis-label';
    div.textContent = text;
    div.style.color = color;
    axesContainer.appendChild(div);
    return div;
}
const labelE = createAxisLabel('E', '#ff8888');
const labelN = createAxisLabel('N', '#88ff88');
const labelZ = createAxisLabel('Z', '#88ccff');

function updateAxesLabels() {
    const pos = new THREE.Vector3();
    const widthHalf = 50;
    const heightHalf = 50;

    const updateLabel = (label, x, y, z) => {
        pos.set(x, y, z).project(axesCamera);
        label.style.left = (pos.x * widthHalf + widthHalf) + 'px';
        label.style.top = (-(pos.y * heightHalf) + heightHalf) + 'px';
    };

    updateLabel(labelE, 1.4, 0, 0);
    updateLabel(labelN, 0, 0, -1.4);
    updateLabel(labelZ, 0, 1.4, 0);
}

// Bucle de animación (utiliza los límites nativos de OrbitControls)
function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);

    // Sincronizar la rotación de la cámara principal con la brújula
    axesCamera.position.copy(camera.position).sub(controls.target);
    axesCamera.position.setLength(4);
    axesCamera.lookAt(axesScene.position);
    axesRenderer.render(axesScene, axesCamera);
    updateAxesLabels();
}
animate();
