'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  guardarCliente, suspenderCliente, reactivarCliente, registrarPagoManual, anularPago, linkPago, linkSuscripcion,
} from '@/actions/plataforma';
import { money } from '@/lib/money';
import { FUNCIONES, ETIQUETA_FUNCION, type Limites } from '@/lib/plan';
import { ETIQUETA_ACCION } from '@/lib/auditoria-etiquetas';
import { ESTADO_ABONO, fechaCorta } from '@/lib/etiquetas-cobro';
import { ETIQUETA_METODO_ABONO } from '@/lib/cobros-etiquetas';

type Cliente = {
  id: string; name: string; slug: string; url: string; activo: boolean; suspendedReason: string | null; suspendedKind: string | null;
  planId: string; maxBranches: string; maxUsers: string; extraFeatures: string[]; price: string;
  paidUntil: string; trialUntil: string; autoSuspend: boolean;
  contactName: string; contactEmail: string; contactPhone: string; notes: string; customDomain: string;
  mpPreapprovalId: string | null; mpModo: string; mpCuenta: string | null;
};
type Pago = {
  id: string; amount: number; months: number; method: string; reference: string; toDate: string; fromDate: string | null;
  createdBy: string; createdAt: string; voidedAt: string | null; voidReason: string | null;
};
type PlanFila = { id: string; name: string; price: number; maxBranches: number; maxUsers: number; features: string[] };

type Props = {
  c: Cliente;
  estado: { tipo: string; vence: string | null; dias: number | null };
  precio: number;
  limites: Limites;
  uso: { sucursales: number; usuarios: number; pedidosMes: number };
  sucursales: { id: string; name: string; slug: string; active: boolean }[];
  pagos: Pago[];
  bitacora: { id: string; action: string; actorName: string; actorType: string; detail: string; createdAt: string }[];
  planes: PlanFila[];
  mpDisponible: boolean;
};

function useAccion() {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pendiente, startTransition] = useTransition();
  const correr = (fn: () => Promise<{ ok: true; aviso?: string } | { ok: false; error: string }>, exito = 'Guardado.') => {
    setMsg(null);
    startTransition(async () => {
      try {
        const r = await fn();
        setMsg(r.ok ? { ok: true, texto: r.aviso ?? exito } : { ok: false, texto: r.error });
        if (r.ok) router.refresh();
      } catch {
        setMsg({ ok: false, texto: 'No se pudo. Revisá la conexión.' });
      }
    });
  };
  return { msg, pendiente, correr };
}

const Mensaje = ({ m }: { m: { ok: boolean; texto: string } | null }) =>
  m ? <p role={m.ok ? 'status' : 'alert'} className={`rounded-lg px-3 py-2 text-sm ${m.ok ? 'bg-verde/10 text-verde' : 'bg-ladrillo/10 text-ladrillo'}`}>{m.texto}</p> : null;

/** La ficha de un cliente en la plataforma: estado, plan, cobros, uso y bitácora. */
export default function FichaCliente(p: Props) {
  const { c } = p;
  const e = ESTADO_ABONO[p.estado.tipo] ?? ESTADO_ABONO.sin_vencimiento;
  const est = useAccion();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl">{c.name}</h1>
          <p className="mt-1 text-sm">
            <a href={c.url} target="_blank" rel="noreferrer" className="font-mono underline">{c.url.replace(/^https?:\/\//, '')}</a>
            {' · '}<a href={`${c.url.replace(/\/$/, '')}/admin`} target="_blank" rel="noreferrer" className="underline">panel</a>
          </p>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${e.clase}`}>{e.label}</span>
            {p.estado.vence && <span>Vence el {fechaCorta(p.estado.vence)}</span>}
            {!c.activo && c.suspendedReason && <span className="text-carbon-500">· {c.suspendedReason}</span>}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          {c.activo ? (
            <button className="btn-peligro" disabled={est.pendiente} onClick={() => {
              const motivo = prompt('Motivo de la suspensión (lo ven sus clientes y su equipo):', 'Este local no está tomando pedidos online por ahora.');
              if (motivo !== null) est.correr(() => suspenderCliente(c.id, motivo), 'Suspendido.');
            }}>Suspender</button>
          ) : (
            <button className="btn-primario" disabled={est.pendiente} onClick={() => est.correr(() => reactivarCliente(c.id), 'Reactivado.')}>Reactivar</button>
          )}
          <Mensaje m={est.msg} />
        </div>
      </div>

      <section className="grid gap-3 sm:grid-cols-4" aria-label="Uso">
        {[
          ['Precio mensual', p.precio ? money(p.precio) : '—'],
          ['Sucursales', `${p.uso.sucursales}${p.limites.maxBranches !== null ? ` de ${p.limites.maxBranches}` : ''}`],
          ['Usuarios activos', `${p.uso.usuarios}${p.limites.maxUsers !== null ? ` de ${p.limites.maxUsers}` : ''}`],
          ['Pedidos este mes', String(p.uso.pedidosMes)],
        ].map(([l, v]) => (
          <div key={l} className="panel p-4"><p className="text-sm text-carbon-500">{l}</p><p className="mt-1 font-display text-2xl tabular-nums">{v}</p></div>
        ))}
      </section>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_440px]">
        <DatosComerciales {...p} />
        <div className="space-y-6">
          <Cobros {...p} />
          <Pagos pagos={p.pagos} />
        </div>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <section className="panel p-5">
          <h2 className="font-display text-lg">Sucursales</h2>
          <ul className="mt-3 divide-y divide-carbon/10 text-sm">
            {p.sucursales.map((s) => (
              <li key={s.id} className="flex justify-between py-2"><span>{s.name} <span className="font-mono text-xs text-carbon-500">/{s.slug}</span></span><span className="text-carbon-500">{s.active ? 'Activa' : 'Apagada'}</span></li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-carbon-500">
            Cobro online del local: <strong>{c.mpModo === 'real' ? `Mercado Pago${c.mpCuenta ? ` · ${c.mpCuenta}` : ''}` : c.mpModo === 'simulado' ? 'Demo' : 'Apagado'}</strong>
          </p>
        </section>
        <section className="panel p-5">
          <h2 className="font-display text-lg">Bitácora</h2>
          <ul className="mt-3 max-h-80 space-y-1.5 overflow-y-auto text-sm">
            {p.bitacora.length === 0 && <li className="text-carbon-500">Sin movimientos.</li>}
            {p.bitacora.map((a) => (
              <li key={a.id} className="flex gap-3">
                <span className="w-28 shrink-0 text-xs text-carbon-500">{new Date(a.createdAt).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}</span>
                <span className="min-w-0"><strong className="font-medium">{ETIQUETA_ACCION[a.action] ?? a.action}</strong>{a.actorName ? ` · ${a.actorName}` : ''}{a.detail ? <span className="block text-xs text-carbon-500">{a.detail}</span> : null}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function DatosComerciales({ c, planes }: Props) {
  const [d, setD] = useState(c);
  const acc = useAccion();
  const plan = planes.find((x) => x.id === d.planId);
  const cambiar = <K extends keyof Cliente>(k: K, v: Cliente[K]) => setD((x) => ({ ...x, [k]: v }));
  const campo = (k: keyof Cliente, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div>
      <label className="label" htmlFor={`f-${k}`}>{label}</label>
      <input id={`f-${k}`} className="input" value={String(d[k] ?? '')} onChange={(e) => cambiar(k, e.target.value as never)} {...extra} />
    </div>
  );

  return (
    <form
      className="panel space-y-5 p-6"
      onSubmit={(e) => {
        e.preventDefault();
        acc.correr(() => guardarCliente(c.id, {
          name: d.name, planId: d.planId, maxBranches: d.maxBranches, maxUsers: d.maxUsers, extraFeatures: d.extraFeatures,
          price: d.price, paidUntil: d.paidUntil, trialUntil: d.trialUntil, autoSuspend: d.autoSuspend,
          contactName: d.contactName, contactEmail: d.contactEmail, contactPhone: d.contactPhone, notes: d.notes, customDomain: d.customDomain,
        }));
      }}
    >
      <h2 className="font-display text-lg">Datos comerciales</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {campo('name', 'Nombre comercial')}
        <div>
          <label className="label" htmlFor="f-plan">Plan</label>
          <select id="f-plan" className="input" value={d.planId} onChange={(e) => cambiar('planId', e.target.value)}>
            <option value="">Sin plan (todo habilitado)</option>
            {planes.map((x) => <option key={x.id} value={x.id}>{x.name} · {money(x.price)}</option>)}
          </select>
        </div>
        {campo('price', 'Precio mensual acordado', { placeholder: plan ? `${plan.price / 100} (el del plan)` : 'Sin precio', inputMode: 'decimal' })}
        {campo('customDomain', 'Dominio propio (opcional)', { placeholder: 'pedidos.sulocal.com.ar' })}
        {campo('maxBranches', 'Sucursales', { placeholder: plan ? `${plan.maxBranches} (el del plan)` : 'Sin límite', inputMode: 'numeric' })}
        {campo('maxUsers', 'Usuarios activos', { placeholder: plan ? (plan.maxUsers ? `${plan.maxUsers} (el del plan)` : 'Sin límite (plan)') : 'Sin límite', inputMode: 'numeric' })}
      </div>

      <div>
        <p className="label">Funciones</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {FUNCIONES.map((f) => {
            const delPlan = !plan || plan.features.includes(f.id);
            const marcado = delPlan || d.extraFeatures.includes(f.id);
            return (
              <label key={f.id} className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-marca" checked={marcado} disabled={delPlan}
                  onChange={(e) => cambiar('extraFeatures', e.target.checked ? [...d.extraFeatures, f.id] : d.extraFeatures.filter((x) => x !== f.id))} />
                <span>{ETIQUETA_FUNCION[f.id]}{delPlan ? <span className="text-carbon-500"> · {plan ? 'del plan' : 'sin plan: todo'}</span> : <span className="text-carbon-500"> · extra para este cliente</span>}</span>
              </label>
            );
          })}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {campo('paidUntil', 'Pagado hasta', { type: 'date' })}
        {campo('trialUntil', 'Prueba hasta', { type: 'date' })}
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" className="h-4 w-4 accent-marca" checked={d.autoSuspend} onChange={(e) => cambiar('autoSuspend', e.target.checked)} />
          Suspender solo si vence y no paga (pasados los días de gracia)
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {campo('contactName', 'Contacto')}
        {campo('contactEmail', 'Email', { type: 'email' })}
        {campo('contactPhone', 'Teléfono')}
      </div>
      <div>
        <label className="label" htmlFor="f-notas">Notas internas</label>
        <textarea id="f-notas" className="input min-h-20" value={d.notes} onChange={(e) => cambiar('notes', e.target.value)} />
      </div>
      <Mensaje m={acc.msg} />
      <button disabled={acc.pendiente} className="btn-primario px-6 py-2.5">{acc.pendiente ? 'Guardando...' : 'Guardar'}</button>
    </form>
  );
}

function Cobros({ c, precio, mpDisponible }: Props) {
  const [monto, setMonto] = useState(precio ? String(precio / 100) : '');
  const [meses, setMeses] = useState('1');
  const [metodo, setMetodo] = useState('TRANSFERENCIA');
  const [referencia, setReferencia] = useState('');
  const [email, setEmail] = useState(c.contactEmail);
  const [link, setLink] = useState('');
  const acc = useAccion();
  const mp = useAccion();

  return (
    <section className="panel space-y-4 p-5">
      <h2 className="font-display text-lg">Cobrar</h2>
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); acc.correr(() => registrarPagoManual(c.id, { monto, meses, metodo, referencia })); }}>
        <div>
          <label className="label" htmlFor="p-monto">Monto</label>
          <input id="p-monto" className="input" inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} required />
        </div>
        <div>
          <label className="label" htmlFor="p-meses">Meses</label>
          <input id="p-meses" className="input" type="number" min={1} max={24} value={meses} onChange={(e) => setMeses(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="p-metodo">Medio</label>
          <select id="p-metodo" className="input" value={metodo} onChange={(e) => setMetodo(e.target.value)}>
            {Object.entries(ETIQUETA_METODO_ABONO).map(([id, l]) => <option key={id} value={id}>{l}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="p-ref">Nº de operación</label>
          <input id="p-ref" className="input" value={referencia} onChange={(e) => setReferencia(e.target.value)} />
        </div>
        <div className="sm:col-span-2"><Mensaje m={acc.msg} /></div>
        <button disabled={acc.pendiente} className="btn-primario sm:col-span-2">{acc.pendiente ? 'Registrando...' : 'Registrar pago'}</button>
      </form>

      <div className="space-y-3 border-t border-carbon/10 pt-4">
        <p className="text-sm font-semibold">Mercado Pago</p>
        {!mpDisponible ? (
          <p className="text-sm text-carbon-500">Para mandar links de pago o débito automático, cargá PLATAFORMA_MP_TOKEN en el servidor.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-fantasma" disabled={mp.pendiente} onClick={() => mp.correr(async () => {
                const r = await linkPago(c.id, Number(meses) || 1);
                if (r.ok) setLink(r.url);
                return r.ok ? { ok: true, aviso: 'Link de pago listo: copialo y mandáselo.' } : r;
              })}>Link de pago ({meses} {meses === '1' ? 'mes' : 'meses'})</button>
            </div>
            <div className="flex gap-2">
              <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Mail de su cuenta de Mercado Pago" aria-label="Mail de Mercado Pago" />
              <button type="button" className="btn-fantasma shrink-0" disabled={mp.pendiente} onClick={() => mp.correr(async () => {
                const r = await linkSuscripcion(c.id, email);
                if (r.ok) setLink(r.url);
                return r.ok ? { ok: true, aviso: 'Link de débito automático listo: al autorizarlo, se le cobra todos los meses.' } : r;
              })}>Débito automático</button>
            </div>
            {c.mpPreapprovalId && <p className="text-xs text-carbon-500">Suscripción generada: {c.mpPreapprovalId}</p>}
            {link && <input readOnly className="input font-mono text-xs" value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Link para mandar" />}
            <Mensaje m={mp.msg} />
          </>
        )}
      </div>
    </section>
  );
}

function Pagos({ pagos }: { pagos: Pago[] }) {
  const acc = useAccion();
  return (
    <section className="panel p-5">
      <h2 className="font-display text-lg">Pagos</h2>
      {pagos.length === 0 ? <p className="mt-2 text-sm text-carbon-500">Todavía no pagó nada.</p> : (
        <ul className="mt-3 divide-y divide-carbon/10 text-sm">
          {pagos.map((x) => (
            <li key={x.id} className={`flex flex-wrap items-baseline justify-between gap-2 py-2 ${x.voidedAt ? 'text-carbon-500 line-through' : ''}`}>
              <span>
                <strong className="tabular-nums">{money(x.amount)}</strong> · {x.months} {x.months === 1 ? 'mes' : 'meses'} · {ETIQUETA_METODO_ABONO[x.method] ?? x.method}
                <span className="block text-xs text-carbon-500">{fechaCorta(x.createdAt)} · hasta {fechaCorta(x.toDate)} · {x.createdBy}{x.reference ? ` · ${x.reference}` : ''}</span>
              </span>
              {!x.voidedAt && (
                <button className="text-xs underline" onClick={() => {
                  const motivo = prompt('¿Por qué se anula? El vencimiento vuelve atrás esos meses.');
                  if (motivo) acc.correr(() => anularPago(x.id, motivo), 'Pago anulado.');
                }}>Anular</button>
              )}
            </li>
          ))}
        </ul>
      )}
      <Mensaje m={acc.msg} />
    </section>
  );
}
