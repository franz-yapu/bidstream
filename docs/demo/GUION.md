# Guion del vídeo del reproceso (≈ 2:30)

Lo que se demuestra: la proyección es **desechable** y el log de Kafka es la fuente de verdad. Una
cola borra lo que entrega; aquí se borra la proyección entera, se vuelve a `earliest` y se
reconstruye sola con el **mismo estado**, comprobado con una huella (SHA-256), no a ojo.

## Antes de grabar

1. Terminal grande (fuente ≥ 16 pt), fondo oscuro, sin otras ventanas con datos personales.
2. `make reset` (entorno limpio) y `nvm use 22`.
3. Ensayo en seco: `make demo-reprocess` debe terminar con `IDÉNTICO ✔`.
4. Para que se vea el avance del reproceso, sube el volumen: `scripts/demo-reprocess.sh --pujas 200 --pause 3`.

La demostración usa su propia base de datos, topic y grupo (`projector-demo-<n>`): no toca el
entorno de desarrollo y lo limpia al terminar.

## Escenas

| Tiempo | Pantalla | Qué se dice y se hace |
| ------ | -------- | --------------------- |
| 0:00 | Diagrama del flujo (README) | «Tres consumidores leen el mismo log de forma independiente. Una cola no permite eso.» |
| 0:20 | Terminal: `make demo-reprocess` (paso 1/3) | La API acepta subastas y lotes; las pujas entran por el outbox; el relay publica en Kafka y el `projector` escribe en PostgreSQL. Aparecen los recuentos y la **huella**. |
| 1:00 | Misma terminal | Señalar `lotes`, `pujas`, `adjudicadas` y la huella: «este es el estado». |
| 1:15 | Paso 2/3 | `reprocess`: «borro la proyección y devuelvo el grupo al principio del log». Se ve «proyección vacía; N eventos por reaplicar». |
| 1:35 | Progreso | El contador sube solo hasta N: «nadie lo reconstruye a mano». |
| 2:00 | Paso 3/3 | La huella de antes y la de después son iguales: **IDÉNTICO ✔**. |
| 2:20 | README / ADR-0009 | «Por esto elegí Kafka: el log es la verdad y todo lo demás se puede rehacer.» |

## Comandos que aparecen

```bash
make reset
make demo-reprocess
npm run reprocess -w @bidstream/projector -- --yes   # el paso 2/3, por si se quiere mostrar suelto
```

## Después de grabar

- Revisar el vídeo entero: nada de rutas, usuarios, tokens ni datos personales a la vista.
- Subirlo como **no listado** (o como *release* de GitHub) y poner el enlace en el README
  (sección «Reproceso»). El archivo no se guarda en el repositorio.
