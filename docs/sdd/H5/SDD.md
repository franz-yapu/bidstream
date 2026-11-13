# SDD — H5 · Vídeo del reproceso

- **Ticket:** ClickUp **H5** (`868mvty20`, https://app.clickup.com/t/868mvty20).
- **Autor:** generado con Claude (Entregable 1).
- **Estado:** Borrador (2026-11-13) — pendiente de aprobación
- **Versión:** 0.1 · **Fecha:** 2026-11-13
- **Fuentes de verdad citadas:**
  1. `docs/product/bidstream_spec.md` §5 («Reproceso (lo que hay que grabar en video)… es la mejor demostración del proyecto») y §12 punto 5
  2. `docs/sdd/G2/SDD.md`, `apps/projector/src/reprocess.ts` y `reprocess-cli.ts` (`npm run reprocess -w @bidstream/projector -- --yes`; el grupo es `CONSUMER_GROUPS.projector`)
  3. `apps/projector/src/reprocess.int.test.ts` y `apps/graphql/src/flow.int.test.ts` (la propiedad que se demuestra ya está probada)
  4. `docs/adr/0009-el-log-es-la-fuente-de-verdad.md`

---

## 0 · Preguntas que el ticket pidió cerrar

| # | Pregunta del ticket | Respuesta |
|---|---|---|
| 1 | ¿Qué se graba? | Borrar la proyección, volver a `earliest` y ver cómo se reconstruye sola; el guion está en §2.2 |
| 2 | ¿Dónde se enlaza? | En el README (I1) y en este SDD; el archivo no se guarda en el repositorio (§2.3) |

---

## 1 · Alcance

### Entra

- **Guion** del vídeo (§2.2), de 2–3 minutos, con comandos exactos y lo que debe verse.
- **Script de demostración reproducible** `scripts/demo-reprocess.sh` (+ `make demo-reprocess`): levanta lo necesario, genera N pujas por la API y el outbox, **calcula una huella del estado** (hash de lotes, pujas y ganadores), borra la proyección, reconstruye y vuelve a calcular: imprime `IDÉNTICO ✔` o falla.
- La grabación (§2.3) y su enlace en el README.
- Pruebas del script (§4).

### No entra (a propósito)

- Montaje, locución ni subtítulos profesionales.
- Demostración en Azure (H3): este vídeo es local; el de Azure, si se hace, es otro.
- Cambiar el comportamiento del reproceso (G2 ya está hecho y probado).

### Premisas verificadas (heredadas de `task-brief`)

| Premisa del ticket | Qué hay de verdad |
|---|---|
| «Volver a `earliest`» | Se hace borrando el grupo vacío (el cliente no tiene `setOffsets`); el CLI lo exige con el projector **parado** |
| «Ver cómo se reconstruye sola» | El CLI muestra progreso; mientras tanto GraphQL devuelve un estado parcial (documentado) |
| «Guion en el SDD» | No existía; se define en §2.2 |
| Entorno de demo limpio | El grupo `projector` del entorno dev está **ocupado por procesos huérfanos míos** (PID en la memoria del proyecto); hay que matarlos antes de grabar |
| Herramientas de grabación | Hay `ffmpeg` y `docker` en la máquina; no hay `asciinema` ni captura de escritorio automatizable por mí |

---

## 2 · Diseño técnico

### 2.1 Lo que demuestra

Que la proyección es **desechable** y el log es la verdad: mismo estado antes y después, calculado con una huella, no «a ojo».

### 2.2 Guion (≈ 2:30)

| Tiempo | Pantalla | Qué se dice y se hace |
|---|---|---|
| 0:00 | Diagrama del flujo (README) | «Tres consumidores leen el mismo log de forma independiente; una cola no lo permite.» |
| 0:20 | Terminal 1: `make demo-reprocess` (fase 1) | Genera 2 subastas, 20 lotes y 400 pujas; muestra `lotes=20 pujas=400 huella=ab12…` |
| 0:55 | GraphQL (Altair o `curl`) | Consulta el lote con más pujas: precio actual y ganador |
| 1:10 | Terminal: fase 2 | `npm run reprocess -- --yes`: las tablas quedan en 0; el offset vuelve a `earliest` (lag = total) |
| 1:30 | Terminal: progreso | El lag baja a 0; las filas reaparecen solas |
| 2:00 | Terminal y GraphQL | Misma consulta, **misma huella** → `IDÉNTICO ✔` |
| 2:20 | README | «Tu cola borra lo que consume; Kafka lo conserva.» Enlace al ADR-0009 |

### 2.3 Formato y alojamiento

| Opción | Ventaja | Inconveniente |
|---|---|---|
| **A. Vídeo de pantalla (MP4) grabado por el usuario con el guion**, subido a YouTube (no listado) o a un *release* de GitHub | El que de verdad impresiona en una entrevista | Lo grabas tú: yo no puedo capturar tu pantalla |
| B. Grabación de terminal convertida a GIF/SVG animado en el repo | Reproducible por mí y sin cuentas externas | Menos vistoso; no muestra GraphQL |
| **C. A + B** | El script reproducible sirve de base del vídeo y el GIF queda en el README como respaldo | Más trabajo |

El MP4 **no se versiona** (pesa y el repo es público); se enlaza.

### 2.4 Decisiones y por qué

| Decisión | Elección | Por qué |
|---|---|---|
| Demostrar con huella, no a ojo | Hash estable de la proyección | Convierte la demo en una verificación |
| Script determinista | Datos y orden fijos, `--seed` | La grabación se puede repetir idéntica |
| Entorno | Grupo y topics propios de la demo (`projector-demo`, prefijo `demo.`) | No chocar con el entorno dev ni con los procesos huérfanos |
| Quién graba | El usuario (opción A/C) | Yo no puedo capturar el escritorio |

---

## 3 · Cambios por archivo/módulo

| Archivo/módulo | Cambio |
|---|---|
| `scripts/demo-reprocess.sh` y `scripts/demo/` (nuevo) | Fase 1 (carga) y fase 2 (reproceso + huella) |
| `apps/projector/src/` | Variable `PROJECTOR_GROUP_ID` (por defecto `projector`) para el CLI y el proceso, si la demo usa grupo propio |
| `Makefile` | `make demo-reprocess` |
| `docs/demo/GUION.md` (nuevo) | El guion de §2.2 para quien graba |
| `README.md` (I1) | Enlace al vídeo (o marcador explícito si aún no está) |

---

## 4 · Plan de tests

| Caso | Nivel | Cubre |
|---|---|---|
| La huella es la misma para el mismo estado y cambia si se altera una puja | unit | Fiabilidad de la prueba |
| La huella no depende del orden de las filas ni de los ids de tabla internos | unit | Estabilidad |
| El script de demostración con pocos datos termina con `IDÉNTICO` | integración | La demo funciona |
| Si la proyección difiere tras reconstruir, el script **falla** (se fuerza una alteración) | integración | Que no pueda «mentir» |
| `PROJECTOR_GROUP_ID` cambia el grupo del CLI y su valor por defecto es `projector` | unit | Configuración |
| El guion cita comandos que existen en `package.json`/`Makefile` | documentación | Guion vigente |

**Deliberadamente sin test:** la calidad de la grabación.

---

## 5 · Definition of Done

- [ ] SDD en `docs/sdd/H5/SDD.md`, Estado = Aprobado
- [ ] Script reproducible y guion en el repositorio; pruebas del §4 en verde
- [ ] Vídeo grabado y enlazado (o, si se elige B, GIF generado y enlazado)
- [ ] `npm run check` e `integration` en verde; PR con CI verde y fusionado

---

## 6 · Riesgos

| Riesgo | Gravedad | Mitigación |
|---|---|---|
| Procesos huérfanos ocupan el grupo `projector` | Media | Grupo propio de la demo; además los matas tú (`! kill …`) |
| El vídeo muestra datos o rutas personales | Media | Entorno y usuario de demo; revisar antes de publicar |
| La reconstrucción es tan rápida que no se ve | Baja | Opción `--slow` que reduce el lote y muestra el lag |
| Hospedar el vídeo en un servicio externo | Baja | No lleva secretos; se enlaza, no se sube a ningún servicio sin tu confirmación |

---

## 7 · Preguntas abiertas

1. **Formato:** ¿opción **A** (tú grabas el MP4 con mi guion), **B** (yo genero un GIF de terminal) o **C** (ambas, propuesta)?
2. **Alojamiento del MP4:** ¿YouTube no listado, *release* de GitHub, o prefieres que quede fuera hasta tenerlo?
3. **`PROJECTOR_GROUP_ID`** para que la demo use un grupo propio sin tocar el entorno dev (propuesta). ¿De acuerdo?
4. **Huella del estado** impresa en la demo como prueba de identidad (propuesta). ¿Bien?
