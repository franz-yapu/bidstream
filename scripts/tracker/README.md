# Adaptadores de tracker

Cada adaptador es un CLI chico con la misma forma, para que las skills de
arriba no les importe qué tracker usa el proyecto:

```
<tracker> tasks [filtros]                       # listar
<tracker> create --list ID --file body.json     # crear desde un cuerpo de ticket-cards
<tracker> update ID --file body.json            # pisar name/markdown_content de un ticket existente
<tracker> set ID [--status .. --comment ..]      # cambiar estado/progreso/comentar
```

## Disponibles

- **`clickup`** — Python 3, sin dependencias. Config vía `.clickup.json` en la
  raíz del repo (ver `clickup.json.example`) + un token personal en
  `~/.config/clickup-token` (nunca se commitea). Probado en producción real
  (extraído del proyecto Casper).

## Setup rápido (una vez por persona)

```bash
# 1. Token personal en ClickUp: avatar → Settings → Apps → API Token → Generate
mkdir -p ~/.config
printf '%s' 'pk_TU_TOKEN' > ~/.config/clickup-token
chmod 600 ~/.config/clickup-token

# 2. Config del proyecto (sin secretos)
cp scripts/tracker/clickup.json.example .clickup.json
# editar .clickup.json con tus team_id / space / listas

# 3. Dejarlo en el PATH
chmod +x scripts/tracker/clickup
ln -sf "$(pwd)/scripts/tracker/clickup" ~/.local/bin/clickup

# 4. Verificar
clickup tasks --assignee me
```

## Más de una cuenta de ClickUp en la misma máquina

El token vive por defecto en `~/.config/clickup-token` — **un solo archivo**.
Si ya usás el CLI con otra cuenta (otro workspace, otro cliente) en otro
proyecto de esta misma máquina, **no lo pises**. Guardá el token de esta
cuenta en un archivo aparte y apuntá `CLICKUP_TOKEN_FILE` a él:

```bash
mkdir -p ~/.config
chmod 700 ~/.config
umask 077
read -s -p "Token de esta cuenta: " tok && printf '%s' "$tok" > ~/.config/clickup-token-<alias> && unset tok
chmod 600 ~/.config/clickup-token-<alias>

# en cada comando (o exportado en la shell de este proyecto):
CLICKUP_TOKEN_FILE=~/.config/clickup-token-<alias> clickup tasks --assignee me
```

`CLICKUP_CONFIG` funciona igual para el `.clickup.json` si además querés
tener la config fuera del repo.

## Agregar otro tracker (Jira, Linear, GitHub Issues, ...)

Escribir un script nuevo con los mismos tres subcomandos, leyendo su propio
archivo de config (ej. `.jira.json`) y su propia ubicación de token. Mantenerlo
sin dependencias si la API del tracker es REST simple (con `urllib` del
stdlib alcanza, como en `clickup`); recurrir al SDK oficial del tracker solo
si la API realmente lo necesita (ej. flujo OAuth).

Una vez que exista un adaptador nuevo, `ticket-cards` y `task-brief` usan el
que declare la config del proyecto — nada en esas skills está atado a
ClickUp ya; solo van a necesitar un JSON de ejemplo si la forma del cuerpo del
ticket difiere (custom fields, labels, etc.) — eso va en `_templates/`.
