# Taller · Análisis de sesgos en preguntas de entrevista cualitativa

Adaptación web del taller de identificación de sesgos metodológicos en preguntas
de entrevista semiestructurada, para **Práctica Pedagógica Investigativa V**
(Licenciatura en Literatura y Lengua Castellana, Universidad del Magdalena).

- **Página publicada:** <https://samorwno.github.io/taller-sesgos-entrevista/>
- **Repositorio:** <https://github.com/samorwno/taller-sesgos-entrevista>
- **Registro del curso:** [`respuestas.csv`](respuestas.csv)

## Qué hace

El taller presenta **12 reactivos** inspirados en guiones de entrevista de aula.
En cada uno hay que identificar el sesgo metodológico predominante entre cinco
categorías:

1. Presunción implícita
2. Deseabilidad social
3. Inductividad moderada
4. Doble intención
5. Preguntas dicotómicas

Después de responder se muestra la corrección inmediata, el mecanismo del sesgo,
el fundamento teórico y una reformulación sin sesgo. Al final se genera un
informe con puntaje, nivel analítico, desempeño por categoría y detalle de los
12 reactivos.

El registro pide **solo el nombre completo**; no hay campo de código
estudiantil. Las respuestas se guardan en `respuestas.csv` y el estudiante puede
descargar una copia de su fila.

## Estructura

```text
taller-sesgos-entrevista/
├── index.html          # toda la aplicación (HTML + CSS + JavaScript)
├── respuestas.csv      # registro del curso (encabezado + filas)
├── .nojekyll           # evita el procesamiento de Jekyll en GitHub Pages
├── worker/
│   ├── worker.js       # recibe el POST y escribe en respuestas.csv
│   ├── wrangler.toml   # configuración de Cloudflare Workers
│   ├── test.mjs        # pruebas del Worker con GitHub simulado
│   └── package.json
└── README.md
```

## Registro en el repositorio

GitHub Pages es solo estático: no puede escribir archivos. Tampoco es seguro
poner un token de GitHub en el HTML, porque cualquier visitante podría leerlo.
Por eso el navegador envía la respuesta a un **Worker de Cloudflare** que
custodia el token y hace el commit mediante la API de GitHub:

```text
navegador  →  Worker (token secreto)  →  api.github.com  →  respuestas.csv
```

El Worker:

- acepta únicamente `POST` desde los orígenes configurados en
  `ALLOWED_ORIGINS`;
- valida el nombre, las fechas, el identificador y las 12 respuestas;
- calcula el puntaje y el nivel;
- añade una fila a `respuestas.csv` y hace un commit;
- evita duplicados por `id` y reintenta si otro envío cambió el archivo.

### Configurar el Worker (una sola vez)

1. Crea un token **fine-grained** en
   <https://github.com/settings/personal-access-tokens/new>.
   - Acceso limitado al repositorio `samorwno/taller-sesgos-entrevista`.
   - **Repository permissions → Contents: Read and write**.
   - Una caducidad razonable.
2. Entra a `worker/` y autentica Wrangler:

   ```bash
   cd ~/Work/paginas-web/taller-sesgos-entrevista/worker
   npx wrangler login
   ```

3. Guarda el token como secreto (no se escribe en ningún archivo):

   ```bash
   npx wrangler secret put GITHUB_TOKEN
   ```

4. Despliega:

   ```bash
   npx wrangler deploy
   ```

   Wrangler imprime una URL parecida a
   `https://taller-sesgos-csv.<subdominio>.workers.dev`.

5. Pega esa URL en el `index.html`, en la etiqueta del encabezado:

   ```html
   <meta name="csv-endpoint" content="https://taller-sesgos-csv.<subdominio>.workers.dev">
   ```

6. Haz commit y push. GitHub Pages reconstruye la página y, desde ese momento,
   cada intento terminado se registra en `respuestas.csv`.

Mientras el Worker no esté configurado, el informe muestra un aviso y el botón
**Descargar mi registro (.csv)** sigue funcionando.

### Formato del CSV

`respuestas.csv` tiene una fila por estudiante y 33 columnas:

| Columna | Contenido |
|---|---|
| `id` | UUID del intento; evita registros duplicados |
| `fecha_inicio`, `fecha_cierre` | Fechas ISO 8601 |
| `duracion_min` | Minutos entre el registro y el cierre |
| `nombre` | Nombre completo escrito por el estudiante |
| `puntaje`, `total` | Aciertos y número de reactivos (12) |
| `porcentaje` | Precisión sobre 12 reactivos |
| `nivel` | Nivel analítico calculado |
| `r01`…`r12` | Letra elegida en cada reactivo (A–D) |
| `ok01`…`ok12` | 1 si acertó, 0 si falló |

El archivo usa comas como separador y comillas solo cuando hacen falta. Las
celdas que empiezan por `=`, `+`, `-` o `@` se neutralizan para evitar
inyección de fórmulas al abrirlo en Excel. La descarga individual incluye BOM
para que Excel reconozca la UTF-8; el archivo del repositorio no lo incluye.

## Privacidad

- El repositorio es **público**: el nombre y los resultados de cada estudiante
  quedan visibles en `respuestas.csv` y en el historial de commits.
- El taller pide solo el nombre; no se recogen correos, documentos, teléfonos
  ni códigos.
- El token de GitHub vive como secreto del Worker y nunca se envía al
  navegador.
- El Worker solo escribe en este repositorio y solo acepta peticiones de los
  orígenes configurados. La URL del Worker es pública, así que una persona
  externa podría intentar enviar filas; quedan registradas en el historial y
  se pueden borrar con un commit.
- Si el curso necesita privacidad, usa un identificador en lugar del nombre o
  mueve el registro fuera de un repositorio público.

## Desarrollo

No hay build en la página. Para probarla localmente:

```bash
cd ~/Work/paginas-web/taller-sesgos-entrevista
python3 -m http.server 8000
# abrir http://localhost:8000
```

El endpoint local debe estar permitido en `ALLOWED_ORIGINS` del Worker
(`http://localhost:8000` ya está incluido).

### Pruebas

```bash
cd worker && npm test
```

Las pruebas simulan la API de GitHub y cubren: creación del encabezado,
registro válido, deduplicación, CORS, validación de respuestas y fechas,
reintento tras un conflicto de `sha`, neutralización de fórmulas y falta de
configuración.

La página se verificó con Chromium headless a 1280 px y 390 px: registro,
12 reactivos, retroalimentación, informe, recarga con persistencia, revisión y
descarga lógica del CSV, sin errores de JavaScript ni desbordamiento
horizontal.

## Limitaciones

- Sin el Worker desplegado no hay registro automático; solo descarga local.
- El guardado es un commit por estudiante. En un grupo grande, el historial del
  repositorio crece rápido; no es un problema para un taller, pero no es una
  base de datos.
- La API de contenidos de GitHub sirve archivos de hasta 1 MB. Con ~200 bytes
  por fila, el límite ronda las 5.000 respuestas.
- No hay panel docente ni edición posterior: al terminar, el intento queda
  cerrado. Para cambiar respuestas hay que usar **Nuevo intento**.
- La tipografía se carga desde Google Fonts; si no hay red en la primera
  visita, el navegador usa la fuente del sistema.
- El avance se guarda en `localStorage`. En modo privado o con el
  almacenamiento bloqueado, se pierde al recargar.

## Créditos

Contenido del taller: Práctica Pedagógica Investigativa V (Licenciatura en
Literatura y Lengua Castellana, Universidad del Magdalena). Escenarios
adaptados de los guiones de Henry y Rueda, Gómez, Pérez y Pérez, y Escorcia,
Cataño y Tapia. Fuentes metodológicas: Bisquerra (2004), Ruiz Olabuénaga
(1999), Taylor y Bogdan (1986).

Adaptación web, rediseño y registro en GitHub: Sergio Moreno.
