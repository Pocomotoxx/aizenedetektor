# AI Zene Detektor

Helyben futó, böngészős MVP AI által generált zene előszűrésére. A hanganyag nem töltődik fel: a dekódolás és a spektrális elemzés a felhasználó böngészőjében történik.

## Indítás

```bash
npm start
```

Ezután nyisd meg: `http://localhost:4173`.

## Mit jelent a pontszám?

A pontszám egy transzparens, **nem betanított** heurisztika. A 1–8 kHz-es sáv spektrális csúcsait, periodikusságát, magasfrekvenciás textúráját és azok időbeli stabilitását összegzi. Ez nem bizonyíték AI-eredetre, és nem helyettesít validált, folyamatosan frissített tanított modellt.

## Következő lépés éles használathoz

1. Jogtisztán összeállított, generátoronként és műfajonként kiegyensúlyozott adatbázis.
2. Elkülönített tesztkészlet, illetve transzkódolási, mastering- és rövid-részlet robusztussági mérés.
3. Kalibrált ML/ONNX-osztályozó és verziózott küszöbértékek.
4. Human-in-the-loop felülvizsgálat a küszöb körüli vagy nagy következményű döntésekhez.

## Inspiráció és licencelés

Az architektúra kutatási inspirációja: Deezer ISMIR 2025 fakeprint/Fourier-megközelítés és a közösségi ONNX/CQT demók. A Deezer megvalósítása CC BY-NC 4.0 licencű; annak kódját, modelljét és súlyait ez a projekt nem használja. A referenciákat integrálás előtt egyenkénti licenc- és adatellenőrzésnek kell alávetni.
