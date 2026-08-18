# Tengo Sed — motor de publicación diaria

Publica en Instagram y Facebook automáticamente, y te manda el borrador de
WhatsApp Status al teléfono. 46 slots por semana, hora de Santiago.

Diagrama y plan: https://claude.ai/code/artifact/95121780-6e5c-424a-accf-7fa5484f3c2a

---

## Qué ya está hecho

**En Google Drive** (creado 2026-08-17):

| Carpeta / archivo | ID |
|---|---|
| `Tengo Sed — Redes` | `12ZDIxnt_sY9oDX5JlC6Uk3CR8vX0AwNh` |
| `└ 1 Por publicar` | `12HvBwzoad40QwZz3rgHoMZTEB_Gysbrl` |
| `└ 2 Publicado` | `124LkQeu4SxY1qq5NMibeoj_LOalszo9-` |
| `└ 3 Plantillas y logo` | `1lSH7vE0xtdOkvhHaRJzoYWBRkRWsLOOk` |
| `└ Cola de publicaciones` | `1Q1Z46f1FZ7DWGuaFPTWKWeGn1tdxkBNdTFyNwyv4zus` |

**En este repo:** los 4 workflows, generados con
`node build-social-workflows.js`. No edites los `.json` a mano — edita el
script y vuelve a correrlo, así no se pierden los cambios.

**Verificado:** las 10 reglas cron reproducen los 46 slots exactos del
brief, día por día. Sin extras, sin faltantes.

---

## Lo que falta — requiere tus logins

Yo no puedo (ni debo) entrar a tus cuentas. Estos 6 pasos son tuyos.

### 1. Publicar la app OAuth de Google a Producción — **hazlo primero**

https://console.cloud.google.com/auth/audience?project=n8nn-501607

→ **Publicar app** → confirmar.

Sin esto el token de Drive muere cada **7 días** y la publicación diaria
se cae una vez por semana. Es exactamente lo que te costó horas en agosto.
Vas a ver una advertencia de "app no verificada" una sola vez: Configuración
avanzada → Ir a sslip.io.

### 2. Instagram → cuenta de empresa, vinculada a la página de Facebook

App de Instagram → Configuración → Cuenta → Cambiar a cuenta profesional →
Empresa → vincular la página de Facebook de Tengo Sed.

**No hay alternativa.** La API de publicación no existe para cuentas
personales.

### 3. Crear la app en Meta

https://developers.facebook.com/apps → Crear app → tipo **Empresa**.
Agregar productos: **Instagram Graph API** y **Facebook Login**.

No necesitas App Review: publicar en cuentas propias funciona con acceso
estándar.

### 4. Token de página de larga duración

En el **Graph API Explorer**:

1. Pedir permisos: `pages_manage_posts`, `pages_read_engagement`,
   `instagram_basic`, `instagram_content_publish`, `pages_show_list`
2. Generar token de usuario → cambiarlo por uno de larga duración
3. `GET /me/accounts` → copiar el `access_token` de la página

Ese token de página **no expira** mientras no cambies la contraseña.

### 5. Los cuatro datos que necesito

Pásame estos y reconstruyo en un comando:

| Dato | Dónde sale |
|---|---|
| `IG_USER_ID` | `GET /me/accounts?fields=instagram_business_account` |
| `FB_PAGE_ID` | `GET /me/accounts` |
| `OWNER_CHAT_ID` | escribile a `@userinfobot` en Telegram |
| `MEDIA_SECRET` | inventá una cadena larga al azar |

### 6. Importar y conectar en n8n

https://n8n.136.65.229.48.sslip.io

1. **Credencial nueva** → *Header Auth* → nombre `Meta Graph`
   - Name: `Authorization`
   - Value: `Bearer <token de página del paso 4>`
2. **Workflows → Import from File** → los 4 `.json`, en orden 4, 3, 2, 1
3. En Flow 1, nodo **Publicar** → elegir el workflow *Social — Publicador*
4. En Flows 1, 2 y 3 → Settings → **Error Workflow** → *Social — Alertas*
5. Abrir cada nodo de Google Sheets y Drive y **re-elegir** el documento
   desde el desplegable (n8n necesita cachear el nombre)
6. Activar Flow 3 (**crítico** — si está apagado, Meta recibe 404 y falla
   todo), Flow 4, y por último Flow 1

---

## Cómo se usa el día a día

1. Subís la imagen o video a **1 Por publicar**
2. Agregás una fila en **Cola de publicaciones**:
   - `archivo` — el nombre exacto del archivo
   - `caption_ig` / `caption_fb` / `caption_wa`
   - `estado` → `listo`
   - `prioridad` → `alta` si querés que se salte la fila
3. Listo. El próximo slot lo toma.

El motor escribe de vuelta en la misma fila: `estado` pasa a `publicado`,
con hora y links. El archivo se mueve solo a **2 Publicado**.

Para pausar algo sin borrarlo: `estado` → `pausa`.

### El aviso MINSAL es automático

A cada caption se le agrega *"Bebe con moderación. Prohibida su venta a
menores de 18 años"* antes de publicar, salvo que ya lo hayas escrito vos.
No tenés que acordarte.

---

## Cosas que van a fallar en algún momento

| Síntoma | Causa casi segura |
|---|---|
| Todo falla una vez por semana | Paso 1 sin hacer — token de Drive vencido |
| IG publica imagen en blanco | Flow 3 apagado, o el poll se sacó |
| Todos los slots corren 4 h corridos | Timezone del workflow ≠ `America/Santiago` |
| FB publica, IG no | Instagram sigue como cuenta personal |
| Falla sólo con videos | e2-micro sin RAM — revisá el swap de 2 GB |

Cuando algo falla, Flow 4 te avisa por Telegram con el nodo exacto. La fila
**queda en `listo`** y se reintenta en el siguiente horario — no se pierde.

---

## Dos advertencias honestas

**8 posts por día en Instagram es mucho.** El límite de la API son 50/día
así que no se va a romper, pero el algoritmo premia 1–2 diarios; el alcance
por post suele caer. Vale la pena medir un mes y ajustar.

**46 creativos nuevos por semana** es lo que pide este calendario antes de
empezar a repetir. Si el ritmo de contenido no da, conviene bajar slots
antes que repetir posts.

---

# Flow 5 — Generador de captions (Gemini)

Escribe los tres captions solo, con la API de Gemini en su **capa gratis**
(sin tarjeta, sin VM, sin costo). Construido con
`node build-caption-generator.js` → `flow-5-generador-captions.workflow.json`.

Modelo `gemini-2.5-flash-lite`: **15 por minuto / 1000 por dia**. El flujo
procesa maximo 12 filas por corrida y espera 5s entre cada una, asi que no
toca el limite ni con el calendario completo de 46 posts semanales.

## Los 4 pasos

### 1. Sacar la key

https://aistudio.google.com/apikey → **Create API key** → copiala.

Sin tarjeta de credito. Es otra pantalla distinta a la consola de GCP que te
complico en agosto — esta es de una sola pantalla.

### 2. Credencial en n8n

**Credentials → New → Header Auth**, nombre `Gemini`:

| Campo | Valor |
|---|---|
| Name | `x-goog-api-key` |
| Value | la key del paso 1 |

### 3. Importar

**Workflows → Import from File** → `flow-5-generador-captions.workflow.json`

Despues, adentro:
- Nodo **Escribir con Gemini** → elegir la credencial `Gemini`
- Nodos **Leer la cola** y **Guardar en la cola** → re-elegir el documento
  desde el desplegable (n8n necesita cachear el nombre)
- Nodo **Avisar al dueno** → reemplazar `REPLACE_OWNER_CHAT_ID`
- Settings → **Error Workflow** → *Social — Alertas*

### 4. Probar

1. En la hoja **Cola de publicaciones**, agrega una columna `nota` (opcional
   pero recomendada — es donde le decis de que va la foto)
2. Sube una imagen a *1 Por publicar*
3. Agrega una fila: `archivo` = el nombre exacto, `estado` = `borrador`,
   `nota` = "llego cerveza artesanal"
4. Abri el flujo y dale **Execute workflow**
5. En ~10 segundos la fila deberia tener los 3 captions y `estado` = `listo`

Si sale bien, **activalo**. Corre solo cada dia a las 10:00.

## Como cambia tu rutina

Antes tenias que escribir 46 captions por semana a mano. Ahora:

| Vos ponés | El sistema hace |
|---|---|
| la imagen en *1 Por publicar* | |
| fila con `archivo` + `estado`=`borrador` + `nota` | Flow 5 escribe los 3 captions → `listo` |
| (opcional) editás el texto si no te gustó | Flow 2 publica en el proximo slot |

Podes revisar y corregir los captions antes de que salgan — quedan en la hoja
en `listo` hasta que llegue el horario.

## Detalles que importan

- **Nunca pisa texto tuyo.** Solo toca filas en `borrador`. Si vos escribiste
  el caption y pusiste `listo`, Flow 5 ni la mira.
- **El aviso del MINSAL no se le pide a Gemini** — Flow 2 lo agrega solo. Una
  sola fuente de esa frase, asi no aparece duplicada.
- **Si Gemini falla o se niega**, la fila queda en `borrador` y se reintenta
  mañana. No escribe basura en la hoja.
- **No inventa precios.** Esta prohibido en el prompt. Si querés un precio en
  el caption, escribilo vos en la `nota`.
