'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { guardarPlan } from '@/actions/plataforma';
import { FUNCIONES } from '@/lib/plan';
import { money } from '@/lib/money';

type Plan = { id: string; name: string; price: number; maxBranches: number; maxUsers: number; features: string[]; active: boolean; clientes: number };

/** Los planes: precio, límites y funciones. Cambiar un plan rige para todos sus clientes. */
export default function EditorPlanes({ planes }: { planes: Plan[] }) {
  return (
    <div>
      <h1 className="font-display text-2xl">Planes</h1>
      <p className="mt-1 mb-5 text-sm text-carbon-500">Cambiar un plan rige al momento para todos sus clientes. A un cliente puntual se le pueden pisar los límites o sumar funciones desde su ficha.</p>
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {planes.map((p) => <FormPlan key={p.id} plan={p} />)}
        <FormPlan />
      </div>
    </div>
  );
}

function FormPlan({ plan }: { plan?: Plan }) {
  const router = useRouter();
  const [d, setD] = useState({
    name: plan?.name ?? '', price: plan ? String(plan.price / 100) : '', maxBranches: String(plan?.maxBranches ?? 1),
    maxUsers: String(plan?.maxUsers ?? 0), features: plan?.features ?? [], active: plan?.active ?? true,
  });
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pendiente, startTransition] = useTransition();
  return (
    <form
      className={`panel space-y-3 p-5 ${plan ? '' : 'border-dashed'}`}
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const r = await guardarPlan({ id: plan?.id, ...d });
          setMsg(r.ok ? { ok: true, texto: 'Guardado.' } : { ok: false, texto: r.error });
          if (r.ok) { if (!plan) setD({ name: '', price: '', maxBranches: '1', maxUsers: '0', features: [], active: true }); router.refresh(); }
        });
      }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-display text-lg">{plan ? plan.name : 'Plan nuevo'}</h2>
        {plan && <span className="text-xs text-carbon-500">{plan.clientes} {plan.clientes === 1 ? 'cliente' : 'clientes'} · {money(plan.price)}</span>}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="label" htmlFor={`n-${plan?.id ?? 'nuevo'}`}>Nombre</label>
          <input id={`n-${plan?.id ?? 'nuevo'}`} className="input" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} required />
        </div>
        <div className="col-span-2">
          <label className="label" htmlFor={`p-${plan?.id ?? 'nuevo'}`}>Precio mensual</label>
          <input id={`p-${plan?.id ?? 'nuevo'}`} className="input" inputMode="decimal" value={d.price} onChange={(e) => setD({ ...d, price: e.target.value })} required />
        </div>
        <div>
          <label className="label" htmlFor={`s-${plan?.id ?? 'nuevo'}`}>Sucursales</label>
          <input id={`s-${plan?.id ?? 'nuevo'}`} className="input" type="number" min={1} value={d.maxBranches} onChange={(e) => setD({ ...d, maxBranches: e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor={`u-${plan?.id ?? 'nuevo'}`}>Usuarios (0 = sin límite)</label>
          <input id={`u-${plan?.id ?? 'nuevo'}`} className="input" type="number" min={0} value={d.maxUsers} onChange={(e) => setD({ ...d, maxUsers: e.target.value })} />
        </div>
      </div>
      <div className="space-y-1.5">
        {FUNCIONES.map((f) => (
          <label key={f.id} className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-marca" checked={d.features.includes(f.id)}
              onChange={(e) => setD({ ...d, features: e.target.checked ? [...d.features, f.id] : d.features.filter((x) => x !== f.id) })} />
            <span>{f.label} <span className="text-carbon-500">· {f.ayuda}</span></span>
          </label>
        ))}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="h-4 w-4 accent-marca" checked={d.active} onChange={(e) => setD({ ...d, active: e.target.checked })} />
        Se ofrece en altas nuevas
      </label>
      {msg && <p className={`text-sm ${msg.ok ? 'text-verde' : 'text-ladrillo'}`}>{msg.texto}</p>}
      <button disabled={pendiente} className="btn-primario w-full">{pendiente ? 'Guardando...' : plan ? 'Guardar' : 'Crear plan'}</button>
    </form>
  );
}
