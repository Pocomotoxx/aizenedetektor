# Hibrid AI-stem detektálás - következő fázis

## Miért nem elég a "separate, then detect"?

Forrás-szeparálás után a generátori artefaktum átkerülhet több stembe, illetve a szeparáló is vihet be saját dekódernyomot. Ezért a szeparált audio közvetlen AI-pontozása nem lehet elsődleges döntési jel.

## Célarchitektúra

Minden 2 másodperces, nem csendes szegmenshez:

1. Az eredeti mix Fourier/fakeprint detektorának pontszáma.
2. Vokál és kíséret relatív STFT-energiája 16 darab, 1 kHz széles sávban, egy vagy több szeparátorral.
3. Külön tanított bináris modell az AI-vokálra és az AI-kíséretre.
4. A szegmens-pontszámok mediánja és a bizonytalansági intervalluma a dal szintjén.

## Szükséges validáció

- Hibrid adatbázis: ismert valós és AI stemek, több hangerőaránnyal.
- Szeparátor- és codec-augmentáció, MP3/AAC/Opus/WAV, EQ, mastering, sebesség- és pitch-módosítás.
- Külön TPR/FPR a vokál és kíséret esetén, külön kis stem-energia mellett.
- A korai rendszer csak "AI-vokál gyanú" / "AI-kíséret gyanú" jelzést adhat, végleges szerzőségi állítást nem.
