import Link from 'next/link';
import { Bricolage_Grotesque, Public_Sans, Courier_Prime } from 'next/font/google';
import s from './InicioPlataforma.module.css';

// La misma gráfica que supregsolutions.com/comanda
const titulos = Bricolage_Grotesque({ subsets: ['latin'], variable: '--sr-display', weight: ['400', '600', '700', '800'], display: 'swap' });
const texto = Public_Sans({ subsets: ['latin'], variable: '--sr-body', weight: ['400', '500', '600', '700'], display: 'swap' });
const ticket = Courier_Prime({ subsets: ['latin'], variable: '--sr-ticket', weight: ['400', '700'], display: 'swap' });

const WHATSAPP = `https://wa.me/5491178220245?text=${encodeURIComponent('Hola, quiero una demo de Comanda Supreg para mi local.')}`;
const EMAIL = 'contacto@supregsolutions.com';
const SUPREG = 'https://supregsolutions.com';

function IconoWhatsapp() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden>
      <path d="M17.47 14.38c-.3-.15-1.75-.86-2.02-.96-.27-.1-.47-.15-.67.15-.2.3-.77.96-.94 1.16-.17.2-.35.22-.64.07-.3-.15-1.25-.46-2.38-1.47-.88-.79-1.47-1.76-1.65-2.06-.17-.3-.02-.46.13-.6.13-.14.3-.35.45-.52.15-.18.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.6-.92-2.2-.24-.58-.49-.5-.67-.5h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.21 3.08c.15.2 2.1 3.2 5.08 4.49.71.3 1.27.49 1.7.63.71.23 1.36.2 1.87.12.57-.09 1.75-.72 2-1.41.25-.7.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35M12.05 21.5h-.01a9.4 9.4 0 0 1-4.8-1.32l-.34-.2-3.57.94.95-3.48-.22-.36a9.4 9.4 0 0 1-1.44-5.01c0-5.2 4.24-9.43 9.44-9.43 2.52 0 4.89.98 6.67 2.77a9.37 9.37 0 0 1 2.76 6.67c0 5.2-4.24 9.43-9.44 9.43m8.03-17.46A11.27 11.27 0 0 0 12.05.72C5.8.72.7 5.8.7 12.07c0 2 .52 3.95 1.52 5.67L.6 23.28l5.67-1.49a11.3 11.3 0 0 0 5.78 1.47h.01c6.26 0 11.35-5.09 11.35-11.35 0-3.03-1.18-5.88-3.33-8.02" />
    </svg>
  );
}

const COLUMNAS = [
  { t: 'Nuevo', p: 'El cliente arma el pedido en tu carta web: tamaños, extras, mitad y mitad. Paga con Mercado Pago o elige efectivo.', q: 'Suena en el mostrador', c: s.nuevo },
  { t: 'Aceptado', p: 'Caja lo acepta con un toque. Salen dos tickets: el de cocina, sin precios, y el de caja, con el vuelto calculado.', q: 'Sale impreso solo' },
  { t: 'En el horno', p: 'La cocina lo ve en su pantalla con letra grande y marca "Empezar" y "Listo". Si se demora, se pone en rojo.', q: 'Pantalla de cocina' },
  { t: 'En camino', p: 'El repartidor ve sus pedidos en el celular, con la dirección y cuánto cobrar. El cliente sigue el estado desde su link.', q: 'Celular del repartidor' },
  { t: 'Entregado', p: 'Queda cobrado y suma en la caja del día. Al cliente se le pide una reseña en Google, justo cuando está contento.', q: 'Entra a los reportes', c: s.listo },
];

const ROLES = [
  {
    t: 'El dueño', p: 'Saber cómo viene el negocio sin estar en el local.',
    l: ['Ventas por día y por hora, ticket promedio y productos más vendidos', 'Tiempos reales de cocina y de reparto', 'Cierres de caja con la diferencia de cada turno', 'Stock con conteo mensual, mermas y aviso de faltantes', 'Varias sucursales, cada una con su carta, precios y números', 'Permisos por empleado: quién cambia precios, quién cancela'],
  },
  {
    t: 'La caja', p: 'Atender rápido, cobrar bien y cerrar sin diferencias.',
    l: ['Tablero con todos los pedidos del día y alerta sonora', 'Carga de pedidos por teléfono, WhatsApp o mostrador', 'Apertura y cierre de caja con arqueo', 'Rendición del efectivo de cada repartidor', 'Efectivo, transferencia, tarjeta y Mercado Pago', 'Mesas, reservas y la cuenta de cada mesa'],
  },
  {
    t: 'La cocina', p: 'Ver qué hay que hacer, de lejos y con las manos ocupadas.',
    l: ['Pantalla grande con los pedidos en orden de llegada', 'Comanda impresa en la térmica, sin precios', 'Aclaraciones destacadas: "sin aceitunas", "bien cocida"', 'La segunda ronda de una mesa sale como agregado, sin repetir lo anterior'],
  },
  {
    t: 'El reparto', p: 'Salir con lo justo y volver con la plata justa.',
    l: ['Solo sus pedidos, en el celular', 'Dirección con link al mapa y teléfono del cliente', 'Cuánto cobrar y cuánto vuelto llevar', 'Marca "en camino" y "entregado" con un toque'],
  },
  {
    t: 'Tu cliente', p: 'Pedir fácil, desde el celular, sin descargar nada.', c: s.cliente,
    l: ['Carta con fotos y precios siempre al día', 'Se ve lo que está agotado y las promos del día', 'Paga online con Mercado Pago o al recibir', 'Códigos de descuento y envío gratis', 'Sigue su pedido paso a paso desde un link', 'Reserva mesa, cumpleaños o evento desde la web'],
  },
];

const RUBROS = [
  { t: 'Pizzería', p: 'Chica y grande, doble muzza con recargo y mitad y mitad con un gusto obligatorio para cada mitad.' },
  { t: 'Hamburguesería', p: 'Combos con bebida y papas a elección, punto de la carne y extra cheddar o bacon.' },
  { t: 'Rotisería', p: 'Pollo entero o medio, guarniciones a elección y control de stock de lo que se cocina por tanda.' },
  { t: 'Empanadas', p: 'Por unidad o por docena, con promos automáticas: "los martes la docena con 20% off".' },
];

/** [función, Local, Completo, Cadena] */
const PLANES: [string, boolean, boolean, boolean][] = [
  ['Carta web propia con tu marca', true, true, true],
  ['Pago online con Mercado Pago', true, true, true],
  ['Tablero de pedidos con alerta', true, true, true],
  ['Pantalla de cocina y comandas impresas', true, true, true],
  ['Promos y códigos de descuento', true, true, true],
  ['Caja con arqueo y rendición de repartidores', false, true, true],
  ['Stock, conteo y mermas', false, true, true],
  ['Mesas, reservas y cuenta de mesa', false, true, true],
  ['Reportes de ventas y tiempos', false, true, true],
  ['Varias sucursales, cada una con su carta', false, false, true],
];

const PREGUNTAS = [
  ['¿Tengo que instalar algo?', 'No. Funciona desde el navegador en el celular, la tablet o la PC del local. Para imprimir comandas en una impresora térmica se instala un pequeño programa en la PC del local, y lo dejamos andando nosotros.'],
  ['¿Qué impresora necesito?', 'Cualquier térmica de 80 mm, conectada por red o por USB. Si tenés una para cocina y otra para caja, cada una recibe su ticket.'],
  ['¿Cómo me llega la plata de Mercado Pago?', 'Directo a tu cuenta de Mercado Pago, no pasa por nosotros. Si cancelás un pedido que ya estaba pagado, el sistema le devuelve la plata al cliente automáticamente.'],
  ['¿Puedo seguir recibiendo pedidos por WhatsApp?', 'Sí. Los cargás desde el mostrador y siguen el mismo camino: cocina, reparto y caja. Además, cuando un cliente pide desde la web, se le abre WhatsApp con el pedido armado para escribirte.'],
  ['¿Emite factura electrónica?', 'Todavía no. Por ahora el sistema registra ventas y cobros, y la factura se sigue haciendo por tu medio habitual.'],
  ['¿Qué pasa si se corta internet?', 'Las comandas que no se pudieron imprimir quedan en cola y salen apenas vuelve la conexión. Los datos se guardan en el servidor con una copia de seguridad diaria.'],
  ['¿Puedo usar mi propio dominio?', 'Sí. La carta puede quedar en la dirección de tu local, por ejemplo pedidos.tupizzeria.com.ar, con tu logo y tus colores.'],
];

const NAV = [
  ['#como-funciona', 'Cómo funciona'],
  ['#que-incluye', 'Qué incluye'],
  ['#planes', 'Planes'],
  ['#preguntas', 'Preguntas'],
];

/** La portada de comandasupreg.com: la misma presentación que supregsolutions.com/comanda, más el ingreso de cada local. */
export default function InicioPlataforma({ dominio }: { dominio: string }) {
  return (
    <div className={`${s.pagina} ${titulos.variable} ${texto.variable} ${ticket.variable}`}>
      <div className={s.fondoLogo} aria-hidden>
        <img src="/marca/supreg-isotipo.png" alt="" />
      </div>

      <header className={s.encabezado}>
        <div className={s.barra}>
          <a href={SUPREG} aria-label="SupReg Solutions">
            <img className={s.logo} alt="Logo SupReg Solutions" src="/marca/supreg-logo.png" />
          </a>
          <nav className={s.nav} aria-label="Principal">
            {NAV.map(([href, t]) => <a key={href} href={href}>{t}</a>)}
          </nav>
          <div className={s.encabezadoAcciones}>
            <Link className={`${s.btn} ${s.btnFantasma} ${s.btnChico}`} href="/login">Ingresar a mi local</Link>
            <a className={`${s.btn} ${s.btnPrimario} ${s.btnChico} ${s.soloEscritorio}`} href="#contacto">Contactanos</a>
            <details className={s.menuMovil}>
              <summary aria-label="Abrir menú">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M4 7h16M4 12h16M4 17h16" /></svg>
              </summary>
              <nav aria-label="Principal móvil">
                {NAV.map(([href, t]) => <a key={href} href={href}>{t}</a>)}
                <a href="#contacto">Contacto</a>
              </nav>
            </details>
          </div>
        </div>
      </header>

      <main className={s.contenido}>
        <section className={s.hero} aria-labelledby="titulo">
          <div className={s.wrap}>
            <div className={s.heroTexto}>
              <p className={s.eyebrow}>Comanda Supreg · Pedidos online para gastronomía</p>
              <h1 id="titulo">Tu propio sistema de pedidos, sin comisiones</h1>
              <p className={s.bajada}>
                El cliente pide desde la web de tu local y paga con Mercado Pago. El pedido suena en el
                mostrador, sale impreso en la cocina y le llega al repartidor. No le pagás un porcentaje
                a ninguna app.
              </p>
              <div className={s.acciones}>
                <a className={`${s.btn} ${s.btnPrimario}`} href={WHATSAPP} target="_blank" rel="noopener">
                  <IconoWhatsapp /> Pedir una demo por WhatsApp
                </a>
                <a className={`${s.btn} ${s.btnFantasma}`} href="#como-funciona">Ver cómo funciona</a>
              </div>
              <div className={s.chips}>
                {['Pizzerías', 'Hamburgueserías', 'Rotiserías', 'Casas de empanadas'].map((c) => <span key={c} className={s.chip}>{c}</span>)}
              </div>
            </div>

            <div className={s.pase} aria-hidden>
              <div className={s.riel} />
              <div className={`${s.comanda} ${s.atras}`}>
                <div className={s.papel}><pre><span className={s.grande}>PEDIDO K-1907</span>{`
RETIRA EN LOCAL
==========================
3 x EMPANADA DE CARNE
1 x FAINÁ
`}</pre></div>
              </div>
              <div className={s.comanda}>
                <span className={s.broche} />
                <div className={s.papel}><pre>{`      *** COCINA ***
==========================
`}<span className={s.grande}>{`PEDIDO A-4821
DELIVERY`}</span>{`
Hoy 21:14
==========================

`}<span className={s.grande}>1 x MUZZARELLA (GRANDE)</span>{`
    + Doble muzzarella

`}<span className={s.grande}>1 x MITAD Y MITAD (GRANDE)</span>{`
    + Napolitana
    + Calabresa
    >> bien cocida

`}<span className={s.grande}>2 x EMPANADA DE CARNE</span>{`
==========================
`}<span className={s.sello}>PAGADO · MERCADO PAGO</span>{`
`}</pre></div>
              </div>
              <div className={s.aviso}>
                <span className={s.campana}>🔔</span>
                <b>Pedido nuevo A-4821</b>
                <small>Envío, pagado online. Recién entrado.</small>
              </div>
            </div>
          </div>
        </section>

        <section className={s.bloque} id="como-funciona" aria-labelledby="t-como">
          <div className={s.wrap}>
            <div className={s.bloqueEncabezado}>
              <p className={s.eyebrow}>Cómo funciona</p>
              <h2 id="t-como">Así viaja un pedido</h2>
              <p className={s.bajada}>
                Cada pedido pasa por las mismas columnas que ve tu equipo en la pantalla. Nadie copia
                nada a mano y nadie pregunta &quot;¿ese ya salió?&quot;.
              </p>
            </div>
            <ol className={s.tablero}>
              {COLUMNAS.map((c, i) => (
                <li key={c.t} className={`${s.columna} ${c.c ?? ''}`}>
                  <h3><i>{i + 1}</i>{c.t}</h3>
                  <p>{c.p}</p>
                  <p className={s.quien}>{c.q}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className={s.bloque} id="que-incluye" aria-labelledby="t-incluye">
          <div className={s.wrap}>
            <div className={s.bloqueEncabezado}>
              <p className={s.eyebrow}>Qué incluye</p>
              <h2 id="t-incluye">Una sola herramienta para todo el local</h2>
              <p className={s.bajada}>Cada persona entra con su usuario y ve solo lo que necesita para su trabajo.</p>
            </div>
            <div className={s.roles}>
              {ROLES.map((r) => (
                <div key={r.t} className={`${s.rol} ${r.c ?? ''}`}>
                  <h3>{r.t}</h3>
                  <p className={s.paraQue}>{r.p}</p>
                  <ul>{r.l.map((x) => <li key={x}>{x}</li>)}</ul>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className={`${s.bloque} ${s.banda}`} id="rubros" aria-labelledby="t-rubros">
          <div className={s.wrap}>
            <div className={s.bloqueEncabezado}>
              <p className={s.eyebrow}>Rubros</p>
              <h2 id="t-rubros">Se adapta a tu carta</h2>
              <p className={s.bajada}>Tamaños, extras con recargo y opciones obligatorias. Con eso se arma lo que vende cada rubro.</p>
            </div>
            <div className={s.carta}>
              {RUBROS.map((r) => (
                <div key={r.t} className={s.plato}>
                  <h3>{r.t}</h3>
                  <p>{r.p}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className={s.bloque} id="planes" aria-labelledby="t-planes">
          <div className={s.wrap}>
            <div className={s.bloqueEncabezado}>
              <p className={s.eyebrow}>Planes</p>
              <h2 id="t-planes">Elegí hasta dónde llegar</h2>
              <p className={s.bajada}>Arrancás con los pedidos online y sumás el resto cuando lo necesites.</p>
            </div>
            <div className={s.planesEnvoltura}>
              <table className={s.planes}>
                <thead>
                  <tr>
                    <th scope="col"><span className={s.oculto}>Función</span></th>
                    <th scope="col"><b>Local</b><small>Pedidos online</small></th>
                    <th scope="col" className={s.destacado}><b>Completo</b><small>Todo el local</small></th>
                    <th scope="col"><b>Cadena</b><small>Varias sucursales</small></th>
                  </tr>
                </thead>
                <tbody>
                  {PLANES.map(([f, ...incluye]) => (
                    <tr key={f}>
                      <th scope="row">{f}</th>
                      {incluye.map((si, i) => (
                        <td key={i} className={`${si ? s.si : s.no} ${i === 1 ? s.destacado : ''}`} aria-label={si ? 'Incluido' : 'No incluido'}>
                          {si ? '✓' : '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className={s.planesPie}>El precio depende de cuántos locales tenés y de qué necesitás. Escribinos y te pasamos una propuesta.</p>
          </div>
        </section>

        <section className={s.bloque} id="preguntas" aria-labelledby="t-preguntas" style={{ paddingTop: 0 }}>
          <div className={s.wrap}>
            <div className={s.bloqueEncabezado}>
              <p className={s.eyebrow}>Preguntas frecuentes</p>
              <h2 id="t-preguntas">Lo que suelen preguntar</h2>
            </div>
            <div className={s.faq}>
              {PREGUNTAS.map(([q, a]) => (
                <details key={q}>
                  <summary>{q}</summary>
                  <p>{a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className={s.cta} id="contacto" aria-labelledby="t-cierre">
          <div className={s.wrap}>
            <div>
              <h2 id="t-cierre">Probalo con tu propia carta</h2>
              <p>Te armamos una demo con tus productos y la probás en el local: hacés un pedido desde el celular y lo ves salir por la impresora.</p>
              <a className={`${s.btn} ${s.btnClaro}`} href={WHATSAPP} target="_blank" rel="noopener">
                <IconoWhatsapp /> Pedir una demo por WhatsApp
              </a>
              <p className={s.email}>O escribinos a <a href={`mailto:${EMAIL}`}>{EMAIL}</a></p>
              <p className={s.yaCliente}>
                ¿Ya tenés Comanda Supreg? <Link href="/login">Ingresá a tu local</Link> o entrá directo por{' '}
                <span>tulocal.{dominio}/admin</span>
              </p>
            </div>
            <div className={s.ticket} aria-hidden><pre>{`   *** PEDIDO DE DEMO ***
==========================
1 x CARTA WEB CON TU MARCA
1 x TABLERO DE PEDIDOS
1 x PANTALLA DE COCINA
    + Comandas impresas
    + Pago con Mercado Pago
    >> sin comisión por pedido
==========================
TOTAL A CONVERSAR`}</pre></div>
          </div>
        </section>
      </main>

      <footer className={s.pie}>
        <div className={`${s.wrap} ${s.pieFila}`}>
          <p>© {new Date().getFullYear()} SupReg Solutions. Todos los derechos reservados.</p>
          <div className={s.pieLinks}>
            <a href={`${SUPREG}/crm`}>Supreg CRM</a>
            <a href={`${SUPREG}/comanda`}>Comanda Supreg</a>
            <a href={`${SUPREG}/conector-whatsapp`}>Conector WhatsApp</a>
            <a href={`${SUPREG}/analytics`}>SupReg Analytics</a>
            <a href={`${SUPREG}/politica-de-privacidad`}>Política de Privacidad</a>
            <a href={`${SUPREG}/terminos-y-condiciones`}>Términos y Condiciones</a>
            <a href="https://www.instagram.com/supregsolutions" target="_blank" rel="noopener">Instagram</a>
            <a href="https://www.linkedin.com/company/supreg-solutions" target="_blank" rel="noopener">LinkedIn</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
