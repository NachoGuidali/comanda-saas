'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { guardarEmpleado, ficharTurno } from '@/actions/operacion';
import { ETIQUETA_ROL, AYUDA_ROL, CATALOGO } from '@/lib/permisos';
import type { Role } from '@prisma/client';
import { hora } from '@/lib/tiempo';

type Turno = { id: string; startedAt: string | null; endedAt: string | null; role: string };
type Empleado = {
  id: string; name: string; email: string; role: string; phone: string | null;
  active: boolean; permisosExtra: string[];
  shifts: Turno[];
  branches: { branchId: string }[];
};
type Sucursal = { id: string; name: string; slug: string };

const ROLES: Role[] = ['ADMIN', 'CAJERO', 'COCINA', 'REPARTIDOR', 'MOZO'];

export default function GestorEmpleados({
  empleados, sucursales, sucursalActiva, puedeEditar, soySuperadmin,
}: {
  empleados: Empleado[]; sucursales: Sucursal[]; sucursalActiva: string;
  puedeEditar: boolean; soySuperadmin: boolean;
}) {
  const router = useRouter();
  const [editando, setEditando] = useState<Empleado | 'nuevo' | null>(null);
  const [pendiente, startTransition] = useTransition();

  const enTurno = empleados.filter((e) => e.shifts.some((s) => s.startedAt && !s.endedAt));

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl">Empleados</h1>
          <p className="mt-1 text-sm text-carbon-500">
            {enTurno.length === 0
              ? 'Nadie fichado hoy en esta sucursal.'
              : `${enTurno.length} en turno: ${enTurno.map((e) => e.name).join(', ')}.`}
          </p>
        </div>
        {puedeEditar && (
          <button onClick={() => setEditando('nuevo')} className="btn-acento">Agregar empleado</button>
        )}
      </div>

      <div className="panel divide-y divide-carbon/10">
        {empleados.length === 0 && (
          <p className="p-8 text-center text-sm text-carbon-500">Todavía no hay empleados cargados.</p>
        )}

        {empleados.map((e) => {
          const turno = e.shifts.find((s) => s.startedAt && !s.endedAt);
          const esSuper = e.role === 'SUPERADMIN';
          const misSucursales = esSuper
            ? sucursales
            : sucursales.filter((s) => e.branches.some((b) => b.branchId === s.id));
          const trabajaAca = esSuper || e.branches.some((b) => b.branchId === sucursalActiva);

          return (
            <div key={e.id} className={`flex flex-wrap items-center gap-4 p-4 ${trabajaAca ? '' : 'opacity-60'}`}>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-marca text-sm font-bold text-crema">
                {e.name.slice(0, 2).toUpperCase()}
              </div>

              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {e.name}
                  {!e.active && <span className="ml-2 text-xs text-carbon-500">inactivo</span>}
                </p>
                <p className="text-sm text-carbon-500">
                  {ETIQUETA_ROL[e.role as Role] ?? e.role} · {e.email}
                  {e.phone && ` · ${e.phone}`}
                </p>
                <p className="mt-0.5 text-xs text-carbon-500">
                  {esSuper ? 'Todas las sucursales' : misSucursales.map((s) => s.name).join(', ') || 'Sin sucursal asignada'}
                  {e.permisosExtra.length > 0 && ` · ${e.permisosExtra.length} permisos extra`}
                </p>
              </div>

              {turno && (
                <span className="rounded-full bg-verde/10 px-3 py-1 text-xs font-semibold text-verde">
                  Desde {hora(turno.startedAt!)}
                </span>
              )}

              {trabajaAca && e.active && (
                <button
                  onClick={() => startTransition(async () => {
                    await ficharTurno(e.id, e.role as Role);
                    router.refresh();
                  })}
                  disabled={pendiente}
                  className={turno ? 'btn-fantasma px-3 py-1.5 text-sm' : 'btn-primario px-3 py-1.5 text-sm'}
                >
                  {turno ? 'Cerrar turno' : 'Fichar entrada'}
                </button>
              )}

              {puedeEditar && (!esSuper || soySuperadmin) && (
                <button onClick={() => setEditando(e)} className="text-sm text-carbon-500 underline">Editar</button>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-4 text-sm text-carbon-500">
        Los repartidores asignados a esta sucursal aparecen en el tablero para darles pedidos.
        Lo que puede hacer cada rol se define en la pantalla de Permisos.
      </p>

      {editando && (
        <Editor
          empleado={editando === 'nuevo' ? null : editando}
          sucursales={sucursales}
          sucursalActiva={sucursalActiva}
          soySuperadmin={soySuperadmin}
          onCerrar={() => setEditando(null)}
          onGuardado={() => { setEditando(null); router.refresh(); }}
        />
      )}
    </div>
  );
}

function Editor({
  empleado, sucursales, sucursalActiva, soySuperadmin, onCerrar, onGuardado,
}: {
  empleado: Empleado | null; sucursales: Sucursal[]; sucursalActiva: string;
  soySuperadmin: boolean; onCerrar: () => void; onGuardado: () => void;
}) {
  const [error, setError] = useState('');
  const [rol, setRol] = useState<string>(empleado?.role ?? 'CAJERO');
  const [asignadas, setAsignadas] = useState<string[]>(
    empleado ? empleado.branches.map((b) => b.branchId) : [sucursalActiva]
  );
  const [extras, setExtras] = useState<string[]>(empleado?.permisosExtra ?? []);
  const [verExtras, setVerExtras] = useState(false);

  const esSuper = rol === 'SUPERADMIN';

  async function enviar(fd: FormData) {
    fd.set('role', rol);
    fd.set('branchIds', asignadas.join(','));
    fd.set('permisosExtra', extras.join(','));
    const res = await guardarEmpleado(fd);
    if (!res.ok) { setError(res.error); return; }
    onGuardado();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-carbon/50 p-4" onClick={onCerrar}>
      <div
        className="scroll-fino max-h-[92vh] w-full max-w-md overflow-y-auto rounded-2xl bg-crema p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-xl">{empleado ? empleado.name : 'Empleado nuevo'}</h2>

        <form action={enviar} className="mt-5 space-y-4">
          {empleado && <input type="hidden" name="id" value={empleado.id} />}

          <div>
            <label className="label" htmlFor="name">Nombre</label>
            <input id="name" name="name" required defaultValue={empleado?.name} className="input" />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="email">Email</label>
              <input id="email" name="email" type="email" required defaultValue={empleado?.email} className="input" />
            </div>
            <div>
              <label className="label" htmlFor="phone">Teléfono</label>
              <input id="phone" name="phone" defaultValue={empleado?.phone ?? ''} className="input" />
            </div>
          </div>

          <div>
            <label className="label" htmlFor="password">{empleado ? 'Contraseña nueva' : 'Contraseña'}</label>
            <input
              id="password" name="password" type="password" required={!empleado} className="input"
              placeholder={empleado ? 'Dejala vacía para no cambiarla' : 'Mínimo 8 caracteres'}
            />
          </div>

          <div>
            <span className="label">Rol</span>
            <div className="grid gap-2">
              {(soySuperadmin ? (['SUPERADMIN', ...ROLES] as Role[]) : ROLES).map((r) => (
                <label
                  key={r}
                  className={`cursor-pointer rounded-xl border px-4 py-2.5 ${
                    rol === r ? 'border-marca bg-marca/5' : 'border-carbon/15 bg-white'
                  }`}
                >
                  <span className="flex items-center gap-3 text-sm font-medium">
                    <input type="radio" checked={rol === r} onChange={() => setRol(r)} className="accent-marca" />
                    {ETIQUETA_ROL[r]}
                  </span>
                  <span className="mt-0.5 block pl-7 text-xs text-carbon-500">{AYUDA_ROL[r]}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <span className="label">
              ¿A qué sucursales entra?
              {esSuper && <span className="ml-2 font-normal text-carbon-500">el superadmin entra a todas</span>}
            </span>
            {!esSuper && (
              <div className="grid gap-2">
                {sucursales.map((s) => (
                  <label
                    key={s.id}
                    className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-2.5 text-sm ${
                      asignadas.includes(s.id) ? 'border-marca bg-marca/5' : 'border-carbon/15 bg-white'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={asignadas.includes(s.id)}
                      onChange={() =>
                        setAsignadas((p) => (p.includes(s.id) ? p.filter((x) => x !== s.id) : [...p, s.id]))
                      }
                      className="h-4 w-4 accent-marca"
                    />
                    {s.name}
                  </label>
                ))}
              </div>
            )}
          </div>

          {!esSuper && (
            <div>
              <button
                type="button"
                onClick={() => setVerExtras((v) => !v)}
                className="text-sm text-carbon-500 underline"
              >
                {verExtras ? 'Ocultar' : 'Dar permisos extra a esta persona'}
                {extras.length > 0 && !verExtras && ` (${extras.length})`}
              </button>

              {verExtras && (
                <>
                  <p className="mt-2 text-xs text-carbon-500">
                    Se suman a los del rol. Sirve para el cajero de confianza que además carga stock,
                    sin tener que cambiarle los permisos a todos los cajeros.
                  </p>
                  <div className="scroll-fino mt-2 max-h-52 space-y-2 overflow-y-auto rounded-xl border border-carbon/15 bg-white p-3">
                    {CATALOGO.map((g) => (
                      <div key={g.grupo}>
                        <p className="text-xs font-semibold uppercase tracking-wide text-carbon-500">{g.grupo}</p>
                        {g.permisos.map((pm) => (
                          <label key={pm.id} className="flex items-center gap-2 py-1 text-sm">
                            <input
                              type="checkbox"
                              checked={extras.includes(pm.id)}
                              onChange={() =>
                                setExtras((p) => (p.includes(pm.id) ? p.filter((x) => x !== pm.id) : [...p, pm.id]))
                              }
                              className="h-4 w-4 accent-marca"
                            />
                            {pm.label}
                          </label>
                        ))}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="active" value="true" defaultChecked={empleado?.active ?? true} className="h-4 w-4 accent-marca" />
            Puede entrar al sistema
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
