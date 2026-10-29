import { getTenant, dominioBase } from '@/lib/tenant';
import FormularioLogin from '@/components/admin/FormularioLogin';
import IngresarALocal from '@/components/plataforma/IngresarALocal';

export const dynamic = 'force-dynamic';

const AVISOS: Record<string, string> = {
  'sin-sucursal': 'Tu usuario no tiene ninguna sucursal activa. Avisale al encargado.',
  'sin-permiso': 'Tu usuario no tiene acceso a ninguna pantalla. Avisale al encargado.',
};

/**
 * Cada local tiene su ingreso en su dirección (pepperino.comandasupreg.com/admin):
 * los usuarios son de ese local. En el dominio de la plataforma se pregunta a
 * qué local se quiere entrar.
 */
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const tenant = await getTenant();
  if (!tenant) return <IngresarALocal dominio={dominioBase()} />;
  const { error } = await searchParams;
  return <FormularioLogin nombre={tenant.name} logoUrl={tenant.logoUrl} aviso={error ? AVISOS[error] : undefined} />;
}
