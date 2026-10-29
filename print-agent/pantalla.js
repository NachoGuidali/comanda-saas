/**
 * La pantalla del programa, en http://127.0.0.1:9123. Está pensada para que la
 * use el dueño del local solo, siguiendo instrucciones por teléfono: código,
 * impresora, prueba y listo.
 */

const PANTALLA = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Comanda Supreg · Impresora</title>
<style>
  :root { --tinta:#14161a; --suave:#5b6170; --linea:#e3e5ea; --fondo:#f5f6f8; --marca:#0f62fe; --ok:#1e8e3e; --mal:#c5221f; --aviso:#b26a00; }
  * { box-sizing: border-box; }
  body { margin:0; font:16px/1.45 system-ui, "Segoe UI", sans-serif; color:var(--tinta); background:var(--fondo); }
  main { max-width:640px; margin:0 auto; padding:32px 16px 48px; }
  h1 { font-size:22px; margin:0 0 4px; }
  h2 { font-size:18px; margin:0 0 12px; }
  p { margin:0 0 12px; }
  .sub { color:var(--suave); margin-bottom:24px; }
  .caja { background:#fff; border:1px solid var(--linea); border-radius:14px; padding:20px; margin-bottom:16px; }
  .paso { color:var(--suave); font-size:13px; text-transform:uppercase; letter-spacing:.06em; margin-bottom:6px; }
  input[type=text] { width:100%; font:inherit; padding:12px 14px; border:1px solid var(--linea); border-radius:10px; }
  #codigo { font:700 30px/1 ui-monospace, Consolas, monospace; letter-spacing:.18em; text-transform:uppercase; text-align:center; }
  button { font:inherit; font-weight:600; border:0; border-radius:10px; padding:11px 18px; cursor:pointer; background:var(--marca); color:#fff; }
  button.sec { background:#fff; color:var(--tinta); border:1px solid var(--linea); }
  button.peligro { background:#fff; color:var(--mal); border:1px solid var(--linea); }
  button:disabled { opacity:.55; cursor:default; }
  .fila { display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-top:14px; }
  .error { color:var(--mal); margin-top:12px; }
  .ok { color:var(--ok); }
  .opcion { display:flex; gap:12px; align-items:flex-start; padding:12px; border:1px solid var(--linea); border-radius:10px; margin-top:8px; cursor:pointer; }
  .opcion:hover { border-color:#b9bfcc; }
  .opcion input { margin-top:4px; }
  .opcion small { display:block; color:var(--suave); }
  .punto { display:inline-block; width:11px; height:11px; border-radius:50%; margin-right:8px; vertical-align:middle; }
  .dato { display:flex; justify-content:space-between; gap:12px; padding:8px 0; border-top:1px solid var(--linea); }
  .dato span:first-child { color:var(--suave); }
  .dato span:last-child { text-align:right; }
  pre { background:#14161a; color:#d7dae0; border-radius:10px; padding:12px; font-size:12px; overflow-x:auto; white-space:pre-wrap; margin:0; }
  details summary { cursor:pointer; color:var(--suave); margin-top:14px; }
  .girando { display:inline-block; width:14px; height:14px; border:2px solid var(--linea); border-top-color:var(--marca); border-radius:50%; animation:g 0.8s linear infinite; vertical-align:-2px; margin-right:6px; }
  @keyframes g { to { transform:rotate(360deg); } }
</style>
</head>
<body>
<main>
  <h1>Impresora de comandas</h1>
  <p class="sub">Comanda Supreg · <span id="version"></span></p>
  <div id="app"><p><span class="girando"></span>Cargando...</p></div>
</main>
<script>
const app = document.getElementById('app');
let datos = null;
let elegida = null;
let lista = null;
let vista = '';

const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const QUE = { todo: 'Todo (cocina y caja)', cocina: 'Solo cocina', caja: 'Solo caja' };

async function pedir(ruta, cuerpo) {
  const r = await fetch(ruta, cuerpo === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-comanda': '1' }, body: JSON.stringify(cuerpo),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'No se pudo');
  return j;
}

async function refrescar() {
  try {
    datos = await pedir('/api/estado');
  } catch {
    return; // se está reiniciando: se vuelve a probar
  }
  document.getElementById('version').textContent = 'v' + datos.version;
  const quiere = !datos.vinculada ? 'codigo' : !datos.config.impresora || vista === 'impresora' ? 'impresora' : 'estado';
  if (quiere !== vista || quiere === 'estado') { vista = quiere; dibujar(); }
}

function dibujar() {
  if (vista === 'codigo') return pantallaCodigo();
  if (vista === 'impresora') return pantallaImpresora();
  pantallaEstado();
}

function pantallaCodigo() {
  app.innerHTML = \`
    <div class="caja">
      <div class="paso">Paso 1 de 2</div>
      <h2>Escribí el código del panel</h2>
      <p>En el panel del local: <strong>Configuración → Impresión y comandas → Agregar impresora</strong>. Son 8 letras y números.</p>
      <form id="f">
        <input id="codigo" type="text" maxlength="9" autocomplete="off" placeholder="ABCD-EFGH" autofocus>
        <details><summary>Opciones avanzadas</summary>
          <p style="margin-top:10px">Dirección del servidor (dejala así salvo que te digan otra):</p>
          <input id="servidor" type="text" value="\${esc(datos.servidorPorDefecto)}">
        </details>
        <div class="fila"><button id="b">Conectar</button></div>
        <p id="e" class="error" hidden></p>
      </form>
    </div>\`;
  const codigo = document.getElementById('codigo');
  codigo.addEventListener('input', () => {
    const t = codigo.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    codigo.value = t.length > 4 ? t.slice(0, 4) + '-' + t.slice(4) : t;
  });
  document.getElementById('f').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const b = document.getElementById('b'), e = document.getElementById('e');
    b.disabled = true; b.textContent = 'Conectando...'; e.hidden = true;
    try {
      await pedir('/api/vincular', { codigo: codigo.value, servidor: document.getElementById('servidor').value });
      vista = 'impresora'; lista = null; await refrescar(); dibujar();
    } catch (err) {
      e.textContent = err.message; e.hidden = false; b.disabled = false; b.textContent = 'Conectar';
    }
  });
}

function opcion(id, titulo, detalle, imp) {
  const marcada = elegida && JSON.stringify(elegida) === JSON.stringify(imp);
  return \`<label class="opcion"><input type="radio" name="imp" data-imp='\${esc(JSON.stringify(imp))}' \${marcada ? 'checked' : ''}>
    <span><strong>\${esc(titulo)}</strong><small>\${esc(detalle)}</small></span></label>\`;
}

async function pantallaImpresora() {
  const c = datos.config;
  if (!elegida && c.impresora) elegida = c.impresora;
  app.innerHTML = \`
    <div class="caja">
      <div class="paso">Paso 2 de 2</div>
      <h2>Elegí la impresora</h2>
      <p>Conectada a <strong>\${esc(c.cliente)} · \${esc(c.sucursal)}</strong> como "\${esc(c.nombre)}" (\${esc(QUE[c.estaciones] || c.estaciones)}).</p>
      <div id="lista">\${lista ? '' : '<p><span class="girando"></span>Buscando impresoras en esta PC y en la red... (unos segundos)</p>'}</div>
      <div class="fila">
        <button id="probar" class="sec" disabled>Imprimir prueba</button>
        <button id="usar" disabled>Usar esta impresora</button>
        \${c.impresora ? '<button id="volver" class="sec">Cancelar</button>' : ''}
      </div>
      <p id="m" hidden></p>
    </div>\`;
  if (c.impresora) document.getElementById('volver').onclick = () => { vista = 'estado'; elegida = null; dibujar(); };
  if (!lista) {
    try { lista = await pedir('/api/impresoras', {}); } catch { lista = { instaladas: [], red: [] }; }
    if (vista !== 'impresora') return;
  }
  let html = '';
  for (const ip of lista.red) html += opcion('r' + ip, 'Impresora de red · ' + ip, 'Conectada al router por cable o WiFi. Es la forma más confiable.', { tipo: 'red', ip, puerto: 9100 });
  for (const p of lista.instaladas.filter((p) => !p.virtual)) {
    html += opcion('u' + p.nombre, p.nombre, (p.puerto ? 'Instalada en esta PC (' + p.puerto + ')' : 'Instalada en esta PC') + (p.apagada ? ' · Windows la marca sin conexión' : ''), { tipo: 'usb', nombre: p.nombre });
  }
  if (!html) html = '<p>No encontramos ninguna. Si es <strong>USB</strong>, conectala, prendela e instalá el driver que vino con la impresora; después tocá <em>Buscar de nuevo</em>. Si es <strong>de red</strong>, escribí su IP abajo (sale en la hoja que imprime al mantener apretado el botón FEED al prenderla).</p>';
  html += \`<details \${elegida && elegida.tipo === 'red' && !lista.red.includes(elegida.ip) ? 'open' : ''}><summary>Escribir la IP a mano</summary>
      <div class="fila"><input id="ip" type="text" placeholder="192.168.1.100" style="flex:1" value="\${elegida && elegida.tipo === 'red' && !lista.red.includes(elegida.ip) ? esc(elegida.ip) : ''}"></div></details>
    <details><summary>Otras opciones</summary>\`;
  for (const p of lista.instaladas.filter((p) => p.virtual)) html += opcion('u' + p.nombre, p.nombre, 'Impresora virtual: no sirve para tickets', { tipo: 'usb', nombre: p.nombre });
  html += opcion('a', 'Sin impresora: mostrar en pantalla', 'Para probar la conexión. Las comandas no se imprimen.', { tipo: 'archivo' });
  html += '</details><div class="fila"><button id="buscar" class="sec">Buscar de nuevo</button></div>';
  document.getElementById('lista').innerHTML = html;

  const probar = document.getElementById('probar'), usar = document.getElementById('usar'), m = document.getElementById('m');
  const ip = document.getElementById('ip');
  const actualizar = () => { probar.disabled = usar.disabled = !elegida; };
  document.querySelectorAll('input[name=imp]').forEach((r) => r.addEventListener('change', () => {
    elegida = JSON.parse(r.dataset.imp); if (ip) ip.value = ''; actualizar(); m.hidden = true;
  }));
  ip.addEventListener('input', () => {
    document.querySelectorAll('input[name=imp]').forEach((r) => { r.checked = false; });
    const v = ip.value.trim();
    elegida = /^\\d{1,3}(\\.\\d{1,3}){3}$/.test(v) ? { tipo: 'red', ip: v, puerto: 9100 } : null;
    actualizar();
  });
  actualizar();
  document.getElementById('buscar').onclick = () => { lista = null; pantallaImpresora(); };
  const mensaje = (texto, ok) => { m.textContent = texto; m.className = ok ? 'ok' : 'error'; m.hidden = false; };
  probar.onclick = async () => {
    probar.disabled = true; probar.textContent = 'Imprimiendo...';
    try {
      await pedir('/api/probar', { impresora: elegida });
      mensaje(elegida.tipo === 'archivo' ? 'Listo: la prueba salió en la ventana negra.' : '¿Salió el ticket de prueba? Si salió bien, tocá "Usar esta impresora".', true);
    } catch (err) { mensaje('No imprimió: ' + err.message, false); }
    probar.disabled = false; probar.textContent = 'Imprimir prueba';
  };
  usar.onclick = async () => {
    usar.disabled = true; usar.textContent = 'Guardando...';
    try {
      const r = await pedir('/api/impresora', { impresora: elegida });
      vista = 'estado'; elegida = null;
      if (r.reinicia) {
        app.innerHTML = '<div class="caja"><h2 class="ok">¡Listo!</h2><p><span class="girando"></span>Pasando a segundo plano: la ventana negra se cierra sola y el programa sigue andando, también cuando se reinicia la PC.</p></div>';
        vista = 'esperando';
        return;
      }
      await refrescar(); dibujar();
    } catch (err) { mensaje(err.message, false); usar.disabled = false; usar.textContent = 'Usar esta impresora'; }
  };
}

function pantallaEstado() {
  const c = datos.config, e = datos.estado;
  const desconocido = e.conectado === null;
  const [color, texto] = e.desvinculada ? ['var(--mal)', 'Esta PC ya no está vinculada. Generá un código nuevo en el panel.']
    : e.conectado === false ? ['var(--mal)', 'Sin conexión con el servidor: ' + e.errorServidor]
    : e.errorImpresora ? ['var(--aviso)', 'Conectado, pero la impresora falla: ' + e.errorImpresora]
    : desconocido ? ['var(--linea)', 'Conectando...'] : ['var(--ok)', 'Andando. Las comandas salen solas.'];
  app.innerHTML = \`
    <div class="caja">
      <h2><span class="punto" style="background:\${color}"></span>\${esc(texto)}</h2>
      <div class="dato"><span>Local</span><span>\${esc([c.cliente, c.sucursal].filter(Boolean).join(' · '))}</span></div>
      <div class="dato"><span>Impresora</span><span>\${esc(c.nombre)} · \${esc(c.descripcion)}</span></div>
      <div class="dato"><span>Imprime</span><span>\${esc(QUE[c.estaciones] || c.estaciones)}\${c.abrirCajon ? ' · abre el cajón' : ''}</span></div>
      <div class="dato"><span>Impresas desde que arrancó</span><span>\${e.impresas}\${e.ultima ? ' · última ' + new Date(e.ultima).toLocaleTimeString('es-AR') : ''}</span></div>
      \${datos.manual ? '<p style="margin-top:12px">Configurado con un archivo .env: los cambios se hacen ahí.</p>' : \`
      <div class="fila">
        <button id="prueba" class="sec">Imprimir prueba</button>
        <button id="cambiar" class="sec">Cambiar impresora</button>
        <button id="salir" class="peligro">Desconectar esta PC</button>
      </div>\`}
      <p id="m" hidden></p>
    </div>
    <div class="caja">
      <h2>Últimos movimientos</h2>
      <pre>\${esc(datos.registro.join('\\n') || 'Nada todavía')}</pre>
      <p style="margin-top:12px;color:var(--suave);font-size:14px">Podés cerrar esta pestaña: el programa sigue andando. Para volver a verla, abrí el programa de nuevo.</p>
    </div>\`;
  if (datos.manual) return;
  const m = document.getElementById('m');
  document.getElementById('prueba').onclick = async (ev) => {
    ev.target.disabled = true;
    try { await pedir('/api/probar', { impresora: c.impresora }); m.textContent = 'Prueba enviada.'; m.className = 'ok'; }
    catch (err) { m.textContent = 'No imprimió: ' + err.message; m.className = 'error'; }
    m.hidden = false; ev.target.disabled = false;
  };
  document.getElementById('cambiar').onclick = () => { vista = 'impresora'; lista = null; elegida = null; dibujar(); };
  document.getElementById('salir').onclick = async () => {
    if (!confirm('¿Desconectar esta PC? Deja de imprimir las comandas hasta que la vuelvas a vincular con un código.')) return;
    await pedir('/api/desvincular', {}).catch(() => {});
    vista = ''; await refrescar();
  };
}

refrescar();
setInterval(() => { if (vista === 'estado' || vista === 'esperando' || vista === '') refrescar(); }, 3000);
</script>
</body>
</html>`;

module.exports = { PANTALLA };
