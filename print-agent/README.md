# Comanda Supreg · Programa de impresión

Corre en la PC del local, no en el servidor. Cada dos segundos le pregunta al
sistema si hay comandas de su impresora y las manda a la térmica (80 o 58mm ESC/POS,
por red o USB).

## Instalación en Windows (lo normal)

1. En el panel: **Configuración → Impresión y comandas → Agregar impresora**.
   Nombre ("Caja") y qué imprime (**Todo** si es la única impresora del local).
   El panel da un código de 8 letras, que sirve una vez durante 30 minutos.
2. En la PC del local, descargar `ComandaSupreg-Impresora.exe` (el link está al
   lado del código) y abrirlo. Si Windows avisa "Windows protegió su PC": *Más
   información → Ejecutar de todas formas*.
3. Se abre una pantalla en el navegador: escribir el código, elegir la impresora
   de la lista, tocar *Imprimir prueba* y *Usar esta impresora*.

Listo: se copia a `%LOCALAPPDATA%\ComandaSupreg`, arranca solo con Windows y sin
ventana. No pide permisos de administrador. Para volver a ver la pantalla
(estado, últimos movimientos, cambiar de impresora), abrir el programa otra vez.

**¿Qué impresora elegir?** La lista muestra las térmicas de red que encuentra
(puerto 9100) y las impresoras instaladas en Windows. Una USB tiene que tener su
driver instalado para aparecer (el que viene con la impresora, o "Generic / Text
Only"). Si es de red y no aparece, se escribe la IP a mano: sale en la hoja que
imprime al prenderla con el botón FEED apretado.

## Lo que se maneja desde el panel, sin ir al local

- Si cada impresora está andando, sin conexión, o conectada pero con la
  impresora fallando (con el error: "no responde", "sin papel"...).
- Imprimir una prueba.
- Qué imprime (todo, solo cocina, solo caja) y si abre el cajón de dinero.
- Pasarla a otra PC (código nuevo: la PC vieja deja de imprimir al usarlo) o
  quitarla.

## Dos impresoras

Se agregan dos en el panel ("Cocina" con *Solo cocina* y "Caja" con *Solo
caja*), cada una con su código. El programa maneja una impresora por PC: cada
impresora se instala en una PC distinta (la de la caja y la de la cocina, o una
Raspberry Pi).

## Linux o Raspberry Pi

Sin pantalla, con Node.js 18 o más nuevo:

```
npm install
node index.js --codigo ABCD-EFGH --ip 192.168.1.50     # impresora de red
node index.js --codigo ABCD-EFGH --usb POS-80           # instalada en CUPS
```

Queda guardado en `~/.comanda-supreg/config.json`. Después, dejarlo como servicio
de systemd que ejecute `node index.js --fondo` en esta carpeta.

La forma anterior, con archivo `.env` (`SERVIDOR`, `PRINT_TOKEN`, `SUCURSAL`...,
ver `.env.example`), sigue andando: la clave general se genera en el panel, en
"Instalación manual".

## Probar sin impresora

En la lista, *Otras opciones → Sin impresora: mostrar en pantalla* (o
`--archivo`, o `MODO=archivo` en el `.env`). Las comandas salen en la ventana en
vez de imprimirse.

## Qué pasa si la impresora se apaga

Las comandas quedan en cola y el programa reintenta, cada vez un poco más
espaciado (hasta cada 30 segundos). Cuando la impresora vuelve, salen en orden.
Una comanda que no pudo salir en 4 horas se descarta: no tiene sentido imprimir
un pedido de anoche al abrir el local. Siempre se puede reimprimir desde la
ficha del pedido.

Si se corta internet justo después de imprimir, el programa recuerda lo que ya
imprimió y no lo repite.

## Rearmar el .exe

```
npm install
npm run exe        # deja ../public/descargas/ComandaSupreg-Impresora.exe
```

Necesita Node 22.12 o más nuevo (con uno anterior:
`NODE_OPTIONS=--experimental-require-module npm run exe`). Se puede armar desde
Linux. El `.exe` no está firmado; para que Windows no muestre el aviso la
primera vez hace falta un certificado de firma de código.

## Dónde guarda las cosas

`%LOCALAPPDATA%\ComandaSupreg` (Windows) o `~/.comanda-supreg` (Linux):
`config.json` (la clave de esta impresora: no compartirlo) y `registro.log`
(lo que fue pasando, para soporte).
