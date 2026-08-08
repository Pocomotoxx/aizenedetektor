# Hibrid AI-stem detektálás - következő fázis

## Miért nem elég a "separate, then detect"?

Forrás-szeparálás után a generátori artefaktum átkerülhet több stembe, illetve a szeparáló is vihet be saját dekódernyomot. Ezért a szeparált audio közvetlen AI-pontozása nem lehet elsődleges döntési jel.

## Kísérleti zajréteg-mérés

A böngészős MVP opcionálisan fogad külső szeparátorral előállított 6+1 stemet: `vocals`, `drums`, `bass`, `guitar`, `piano`, `other` és `residual/noise`. A mix és a stemek között összeveti a spektrális laposságot, a 12–20 kHz-es relatív energiát és a zérusátmenetekből képzett zajindexet. A jelentés csak akkor tekinti érdekesnek a jelenséget, ha a stem-zajindex a mixhez képest stabilan magasabb; ez továbbra sem AI-bizonyíték.

Az elsődleges szeparátor-integrációhoz a `nomadkaraoke/python-audio-separator` használható opcionális Python/Docker szolgáltatásként. A szeparátor és a modell verzióját, hashét, licencét és végrehajtási hardverét minden rekordban rögzíteni kell. Legalább két eltérő szeparátor/modellel és emberi/AI kontrollokkal kell ellenőrizni, mert a szeparátor saját műterméke is zajindex-növekedést okozhat.

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
