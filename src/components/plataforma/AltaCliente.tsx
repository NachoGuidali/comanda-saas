'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { altaCliente } from '@/actions/plataforma';
import { money } from '@/lib/money';

const slugDe = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

/** Alta de un cliente: su dirección, el dueño, el plan y (opcional) la marca. */
export default function AltaCliente({ planes, dominio }: { planes: { id: string; name: string; price: number }[]; dominio: string }) {
  const router = useRouter();
  const [d, setD] = useState({
    nombre: '', slug: '', email: '', password: '', contactName: '', contactPhone: '',
    sucursal: '', direccion: '', whatsapp: '', planId: planes[0]?.id ?? '', diasPrueba: '14',
    principal: '#131313', acento: '#D0202B', fondo: '#FAF6F0',
  });
  const [slugTocado, setSlugTocado] = useState(false);
  const [error, setError] = useState('');
  const [pendiente, startTransition] = useTransition();
  const cambiar = (k: keyof typeof d, v: string) => setD((x) => ({ ...x, [k]: v, ...(k === 'nombre' && !slugTocado ? { slug: slugDe(v) } : {}) }));

  const campo = (k: keyof typeof d, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div>
      <label className="label" htmlFor={`a-${k}`}>{label}</label>
      <input id={`a-${k}`} className="input" value={d[k]} onChange={(e) => cambiar(k, e.target.value)} {...extra} />
    </div>
  );

  return (
    <div className="max-w-3xl">
      <h1 className="mb-5 font-display text-2xl">Nuevo cliente</h1>
      <form
        className="panel space-y-6 p-6"
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          startTransition(async () => {
            const r = await altaCliente({ ...d, diasPrueba: Number(d.diasPrueba) || 0 });
            if (!r.ok) { setError(r.error); return; }
            router.push(`/plataforma/clientes/${r.id}`);
          });
        }}
      >
        <section className="grid gap-4 sm:grid-cols-2">
          {campo('nombre', 'Nombre comercial', { required: true, placeholder: 'La Pizzería' })}
          <div>
            <label className="label" htmlFor="a-slug">Dirección</label>
            <div className="flex items-center rounded-xl border border-carbon/15 bg-white focus-within:border-marca">
              <input id="a-slug" className="min-w-0 flex-1 rounded-l-xl bg-transparent px-3.5 py-2.5 text-sm outline-none" value={d.slug}
                onChange={(e) => { setSlugTocado(true); cambiar('slug', e.target.value.toLowerCase()); }} required />
              <span className="pr-3.5 text-sm text-carbon-500">.{dominio}</span>
            </div>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2">
          <p className="text-sm font-semibold sm:col-span-2">El dueño (entra en /admin con estos datos)</p>
          {campo('contactName', 'Nombre')}
          {campo('contactPhone', 'Teléfono')}
          {campo('email', 'Email', { type: 'email', required: true })}
          {campo('password', 'Contraseña inicial', { required: true, minLength: 8, autoComplete: 'new-password' })}
        </section>

        <section className="grid gap-4 sm:grid-cols-3">
          <p className="text-sm font-semibold sm:col-span-3">Primera sucursal</p>
          {campo('sucursal', 'Nombre', { placeholder: d.nombre || 'Igual que el comercial' })}
          {campo('direccion', 'Dirección')}
          {campo('whatsapp', 'WhatsApp', { placeholder: '5491100000000' })}
        </section>

        <section className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="a-plan">Plan</label>
            <select id="a-plan" className="input" value={d.planId} onChange={(e) => cambiar('planId', e.target.value)}>
              <option value="">Sin plan (todo habilitado, sin precio)</option>
              {planes.map((p) => <option key={p.id} value={p.id}>{p.name} · {money(p.price)}</option>)}
            </select>
          </div>
          {campo('diasPrueba', 'Días de prueba (0 = sin prueba)', { type: 'number', min: 0, max: 90 })}
        </section>

        <section className="grid gap-4 sm:grid-cols-3">
          <p className="text-sm font-semibold sm:col-span-3">Colores <span className="font-normal text-carbon-500">(el dueño los puede cambiar después en Marca)</span></p>
          {(['principal', 'acento', 'fondo'] as const).map((k) => (
            <div key={k}>
              <label className="label" htmlFor={`a-${k}`}>{k === 'principal' ? 'Principal' : k === 'acento' ? 'Acento' : 'Fondo'}</label>
              <div className="flex gap-2">
                <input type="color" aria-label={`Elegir ${k}`} value={d[k]} onChange={(e) => cambiar(k, e.target.value.toUpperCase())} className="h-11 w-12 rounded-lg border border-carbon/15 bg-white p-1" />
                <input id={`a-${k}`} className="input font-mono uppercase" value={d[k]} onChange={(e) => cambiar(k, e.target.value)} />
              </div>
            </div>
          ))}
        </section>

        {error && <p role="alert" className="rounded-lg bg-ladrillo/10 px-3 py-2 text-sm text-ladrillo">{error}</p>}
        <button disabled={pendiente} className="btn-primario px-6 py-2.5">{pendiente ? 'Creando...' : 'Crear cliente'}</button>
      </form>
    </div>
  );
}
