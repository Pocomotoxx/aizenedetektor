# Helyi 6+1 stem-service szerződés

Ez a szerződés a későbbi, lokális Python/Docker szeparátorhoz készült. A jelenlegi böngészős MVP ugyanazt a kimeneti struktúrát külsőleg előállított stemek feltöltésével is kezeli.

## Elvárt kimenet

- `vocals.wav`
- `drums.wav`
- `bass.wav`
- `guitar.wav`
- `piano.wav`
- `other.wav`
- opcionális `residual/noise.wav`

Ha a hat fő stem rendelkezésre áll, a detektor maga is képez residualt:

```text
residual = aligned_mix - (vocals + drums + bass + guitar + piano + other)
```

A residual nem azonos a „remaining/original” komplementer sávval. Az auditban ezért külön szerepel, hogy `computed-mix-minus-six-stems` vagy `uploaded-external-separator-stem` forrásból származik.

## Job-életciklus

A lokális szolgáltatás a későbbi integrációban az alábbi állapotokat adja: `queued`, `analyzing`, `separating`, `ready`, `failed`, `cancelled`. A folyamatjelzés SSE-n vagy más helyi eseménycsatornán érkezhet; a kliensnek támogatnia kell a cancel műveletet, timeoutot és a részleges job törlését.

## Kötelező metaadat

Minden job rögzítse a szeparátor verzióját, a modell nevét és SHA-256 hashét, a mintavételt, a végrehajtási eszközt (`cuda`, `mps`, `cpu`), a bemeneti fájl hashét és a modelllicencet. Ezek a mezők az AI-detektálási audit bizonyítékláncához szükségesek.
