'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CATALOGO, DEFAULTS, ETIQUETA_ROL, AYUDA_ROL } from '@/lib/permisos';
import { guardarPermisosRol, restaurarPermisosRol } from '@/actions/config';
import type { Role } from '@prisma/client';

const ROLES_EDITABLES: Role[] = ['ADMIN', 'CAJERO', 'COCINA', 'REPARTIDOR', 'MOZO'];

export default function GestorRoles({
  permisosPorRol, conteoUsuarios, miRol, soySuperadmin,
}: {
  permisosPorRol: Record<string, string[]>;
  conteoUsuarios: Record<string, number>;
  miRol: Role;
  soySuperadmin: boolean;
}) {
  const router = useRouter();
  const [rol, setRol] = useState<Role>('CAJERO');
  const [marcados, setMarcados] = useState<string[]>(permisosPorRol[rol] ?? DEFAULTS[rol]);
  const [pendiente, startTransition] = useTransition();
  const [mensaje, setMensaje] = useState('');
  const [error, setError] = useState('');

  function elegirRol(r: Role) {
    setRol(r);
    setMarcados(permisosPorRol[r] ?? DEFAULTS[r]);
    setMensaje('');
    setError('');
  }

  const guardados = permisosPorRol[rol] ?? DEFAULTS[rol];
  const hayCambios =
    marcados.length !== guardados.length || marcados.some((p) => !guardados.includes(p));

  function alternar(id: string) {
    setMarcados((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    setMensaje('');
  }

  function alternarGrupo(ids: string[], todos: boolean) {
    setMarcados((prev) => (todos ? prev.filter((x) => !ids.includes(x)) : [...new Set([...prev, ...ids])]));
  }

  function guardar() {
    setError('');
    startTransition(async () => {
      const res = await guardarPermisosRol(rol, marcados);
      if (!res.ok) { setError(res.error); return; }
      setMensaje('Guardado. Los cambios se aplican la próxima vez que cada uno entre.');
      router.refresh();
    });
  }

  return (
    <div>
      <div className="mb-5">
        <h1 className="font-display text-2xl">Permisos</h1>
        <p className="mt-1 max-w-2xl text-sm text-carbon-500">
          Definí qué puede hacer cada rol. Los permisos que terminan en &ldquo;ver&rdquo; son los que
          abren cada sección del menú: sin ellos, la pantalla no aparece.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <aside>
          <div className="panel divide-y divide-carbon/10">
            <div className="p-4">
              <p className="font-medium">Superadministrador</p>
              <p className="mt-1 text-xs text-carbon-500">{AYUDA_ROL.SUPERADMIN}</p>
              <p className="mt-2 text-xs text-carbon-500">{conteoUsuarios.SUPERADMIN ?? 0} usuarios</p>
            </div>
            {ROLES_EDITABLES.map((r) => (
              <button
                key={r}
                onClick={() => elegirRol(r)}
                className={`w-full p-4 text-left transition-colors ${rol === r ? 'bg-marca text-crema' : 'hover:bg-carbon/5'}`}
              >
                <p className="font-medium">{ETIQUETA_ROL[r]}</p>
                <p className={`mt-1 text-xs ${rol === r ? 'text-crema/70' : 'text-carbon-500'}`}>
                  {AYUDA_ROL[r]}
                </p>
                <p className={`mt-2 text-xs ${rol === r ? 'text-crema/60' : 'text-carbon-500'}`}>
                  {(permisosPorRol[r] ?? DEFAULTS[r]).length} permisos · {conteoUsuarios[r] ?? 0} usuarios
                </p>
              </button>
            ))}
          </div>
        </aside>

        <div>
          {!soySuperadmin && rol === miRol && (
            <p className="mb-4 rounded-xl bg-rojo/10 px-4 py-3 text-sm">
              Este es tu propio rol. Si te quitás permisos, los perdés vos también.
            </p>
          )}

          <div className="space-y-4">
            {CATALOGO.map((g) => {
              const ids = g.permisos.map((p) => p.id);
              const todos = ids.every((id) => marcados.includes(id));
              const algunos = ids.some((id) => marcados.includes(id));

              return (
                <section key={g.grupo} className="panel p-5">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="font-display text-lg">{g.grupo}</h2>
                    <button
                      onClick={() => alternarGrupo(ids, todos)}
                      className="text-sm text-carbon-500 underline"
                    >
                      {todos ? 'Desmarcar todo' : 'Marcar todo'}
                    </button>
                  </div>

                  {!algunos && (
                    <p className="mt-1 text-xs text-carbon-500">
                      Sin ningún permiso de este grupo, la sección no se ve en el menú.
                    </p>
                  )}

                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {g.permisos.map((p) => (
                      <label
                        key={p.id}
                        className={`flex cursor-pointer gap-3 rounded-xl border px-3.5 py-2.5 ${
                          marcados.includes(p.id) ? 'border-marca bg-marca/5' : 'border-carbon/15 bg-white'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={marcados.includes(p.id)}
                          onChange={() => alternar(p.id)}
                          className="mt-0.5 h-4 w-4 shrink-0 accent-marca"
                        />
                        <span>
                          <span className="block text-sm font-medium">{p.label}</span>
                          <span className="block text-xs text-carbon-500">{p.ayuda}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>

          {error && <p className="mt-4 rounded-xl bg-ladrillo/10 px-4 py-3 text-sm text-ladrillo">{error}</p>}
          {mensaje && <p className="mt-4 rounded-xl bg-verde/10 px-4 py-3 text-sm text-verde">{mensaje}</p>}

          <div className="sticky bottom-0 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-carbon/10 bg-crema/95 p-4 backdrop-blur">
            <p className="text-sm text-carbon-500">
              {ETIQUETA_ROL[rol]} · {marcados.length} permisos
              {hayCambios && <span className="ml-2 font-medium text-rojo">sin guardar</span>}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => startTransition(async () => {
                  await restaurarPermisosRol(rol);
                  setMarcados(DEFAULTS[rol]);
                  setMensaje('Volvimos a los permisos que trae el sistema por defecto.');
                  router.refresh();
                })}
                disabled={pendiente}
                className="btn-fantasma px-4 py-2.5 text-sm"
              >
                Restaurar
              </button>
              <button onClick={guardar} disabled={pendiente || !hayCambios} className="btn-primario px-6 py-2.5">
                {pendiente ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
