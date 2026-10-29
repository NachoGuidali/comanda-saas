'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { guardarCategoria, borrarCategoria } from '@/actions/catalog';
import SubirImagen from './SubirImagen';

type Categoria = {
  id: string; name: string; description: string | null; imageUrl: string | null;
  position: number; active: boolean; _count: { products: number };
};

export default function GestorCategorias({ categorias }: { categorias: Categoria[] }) {
  const router = useRouter();
  const [editando, setEditando] = useState<Categoria | 'nueva' | null>(null);
  const [error, setError] = useState('');

  return (
    <div>
      <div className="mb-5 flex items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-extrabold">Categorías</h1>
          <p className="mt-1 text-sm text-carbon-500">
            El orden acá es el orden en que las ve el cliente en la carta.
          </p>
        </div>
        <button onClick={() => setEditando('nueva')} className="btn-acento">Agregar categoría</button>
      </div>

      <div className="panel divide-y divide-carbon/10">
        {categorias.length === 0 && (
          <p className="p-8 text-center text-sm text-carbon-500">
            Todavía no hay categorías. Creá la primera para poder cargar productos.
          </p>
        )}
        {categorias.map((c) => (
          <div key={c.id} className="flex items-center gap-4 p-4">
            <span className="w-8 text-center text-sm font-semibold text-carbon-500">{c.position}</span>
            <div className="min-w-0 flex-1">
              <p className="font-medium">{c.name}</p>
              <p className="text-sm text-carbon-500">
                {c._count.products} producto{c._count.products === 1 ? '' : 's'}
                {!c.active && ' · oculta'}
              </p>
            </div>
            <button onClick={() => setEditando(c)} className="btn-fantasma px-3 py-1.5 text-sm">Editar</button>
            <button
              onClick={async () => {
                if (!confirm(`¿Borrar la categoría "${c.name}"?`)) return;
                const res = await borrarCategoria(c.id);
                if (!res.ok) setError(res.error);
                else router.refresh();
              }}
              className="px-2 text-sm text-carbon-500 underline"
            >
              Borrar
            </button>
          </div>
        ))}
      </div>

      {error && <p className="mt-4 rounded-xl bg-ladrillo/10 px-4 py-3 text-sm text-ladrillo">{error}</p>}

      {editando && (
        <Editor
          categoria={editando === 'nueva' ? null : editando}
          onCerrar={() => setEditando(null)}
          onGuardado={() => { setEditando(null); router.refresh(); }}
        />
      )}
    </div>
  );
}

function Editor({
  categoria, onCerrar, onGuardado,
}: {
  categoria: Categoria | null; onCerrar: () => void; onGuardado: () => void;
}) {
  const [imagen, setImagen] = useState(categoria?.imageUrl ?? '');
  const [error, setError] = useState('');

  async function enviar(fd: FormData) {
    fd.set('imageUrl', imagen);
    const res = await guardarCategoria(fd);
    if (!res.ok) { setError(res.error); return; }
    onGuardado();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-carbon/50 p-4" onClick={onCerrar}>
      <div className="w-full max-w-md rounded-2xl bg-crema p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-xl font-bold">
          {categoria ? categoria.name : 'Categoría nueva'}
        </h2>

        <form action={enviar} className="mt-5 space-y-4">
          {categoria && <input type="hidden" name="id" value={categoria.id} />}

          <div>
            <label className="label" htmlFor="name">Nombre</label>
            <input id="name" name="name" required defaultValue={categoria?.name} className="input" placeholder="Pizzas" />
          </div>

          <div>
            <label className="label" htmlFor="description">Descripción</label>
            <input id="description" name="description" defaultValue={categoria?.description ?? ''} className="input" placeholder="Opcional" />
          </div>

          <SubirImagen valor={imagen} onCambio={setImagen} etiqueta="Imagen de portada" />

          <div>
            <label className="label" htmlFor="position">Orden</label>
            <input id="position" name="position" type="number" defaultValue={categoria?.position ?? 0} className="input" />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="active" defaultChecked={categoria?.active ?? true} className="h-4 w-4 accent-marca" />
            Visible en la carta
          </label>

          {error && <p className="rounded-xl bg-ladrillo/10 px-4 py-3 text-sm text-ladrillo">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button className="btn-primario flex-1 py-3">Guardar</button>
            <button type="button" onClick={onCerrar} className="btn-fantasma px-5">Cancelar</button>
          </div>
        </form>
      </div>
    </div>
  );
}
