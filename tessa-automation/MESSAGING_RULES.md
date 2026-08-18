# Reglas de mensajería — obligatorias para TODOS los agentes

Aplica a cualquier agente o workflow que escriba a Telegram, WhatsApp o cualquier
canal del grupo Tengo Sed. No es una sugerencia de estilo: los mensajes se leen en
un teléfono, de pie, detrás del mostrador.

## 1. Nunca mandar mensajes pegados

- **Mínimo 10 segundos entre mensajes** (`MESSAGE_GAP_SECONDS = 10`).
- En n8n: un nodo `Wait` de 10 s entre cada nodo Telegram, en cadena.
- Nunca disparar dos nodos Telegram en paralelo desde el mismo nodo.
- Razón: un bloque de 3 mensajes de golpe se lee como spam, el local ignora los
  últimos, y Telegram limita el grupo.

## 2. Un mensaje = un tema

- Resumen, ajuste de negativos y conteo del día son **tres** mensajes, no uno.
- Si un mensaje necesita dos títulos, son dos mensajes.

## 3. Formato de bloque

```
TITULO — Local
--------------------------------
SECCION  (n productos)
--------------------------------
 1. Nombre del producto
    ACCION 52   (dato, dato)
 2. Nombre del producto
    ACCION 40   (dato, dato)
```

- Título arriba, línea separadora, ítems numerados.
- **La acción va primero** en la línea de detalle: `PEDIR 52`, no
  `quedan 26, vendio 78 -> pedir 52`. El local necesita el número que tiene que
  ejecutar, no la aritmética.
- Los datos de apoyo van entre paréntesis, después.
- Máximo 25 ítems por sección; el resto se resume como `...y N productos mas.`

## 4. Lo urgente va arriba

- Archivos desactualizados, errores y cualquier cosa que invalide el resto del
  mensaje se pone **antes** de los números, no al final.

## 5. Texto plano

- Sin emoji. Sin markdown. Sin negrita.
- Límite duro 3.890 caracteres; cortar con `...(cortado)`.
- Español simple, sin tecnicismos.

## 6. No repetir sin razón

- Si el local ya respondió, no se le vuelve a escribir.
- Un recordatorio solo lleva **lo que falta**, nunca la lista completa otra vez.
- Si no falta nada, no se manda ningún mensaje.

## 7. Pedir siempre en el mismo formato

- Las respuestas del local son `SKU cantidad`, una línea por producto.
- Todo mensaje que pida datos debe mostrar un ejemplo real con un SKU de esa
  misma lista.

## Dónde está implementado

- `calc-core-v2.js` — `SEP`, `pad()`, `buildReport()`, `buildNegativesTask()`,
  `buildCountTask()`, `buildReminder()`, `buildFilesWarning()`.
- `build-flow-a-v2.js` — `MESSAGE_GAP_SECONDS` y los nodos `Esperar 10s`.
- `test-calc-core-v2.js` — cubre límite de caracteres, secciones y recordatorios.
