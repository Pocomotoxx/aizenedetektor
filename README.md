# AI Zene Detektor

Helyben futó, böngészős MVP kétoldalú zenei forenzikához. A hanganyag nem töltődik fel: a dekódolás és a spektrális elemzés a felhasználó böngészőjében történik.

A számításigényes elemzés külön Web Workerben fut, ezért a felület a hosszabb fájlok feldolgozása közben is reszponzív marad. A kimutatott eredményhez vizuális, kijelző célú spektrogram is készül; ez nem része a döntési pontszámnak.

## Indítás

```bash
npm start
```

Ezután nyisd meg: `http://localhost:4173`.

## Mit jelent a pontszám?

A pontszám egy transzparens, **nem betanított** heurisztika. A spektrális csúcsokat, periodikusságot, magasfrekvenciás textúrát, időbeli stabilitást és a 0–2 / 2–6 / 6–12 kHz sávok eltérését összegzi. A rendszer több, a teljes dalon elosztott szegmensből önhasonlósági/szerkezeti jelzést is számol, de ezt - kalibrált referenciahalmaz hiányában - szándékosan nem keveri bele az AI-pontszámba. Ez nem bizonyíték AI-eredetre, és nem helyettesít validált, folyamatosan frissített tanított modellt.

## Kétoldalú értékelés

1. **AI-artefaktum kockázat:** ismert, Fourier-alapú forenzikus jelekből származó heurisztikus pontszám.
2. **Emberi referencia-illeszkedés:** a felhasználó által betöltött, ismerten emberi zenékből helyben képzett egyosztályos referencia. A pontszám azt jelzi, hogy a vizsgált fájl mennyire illeszkedik ehhez a referenciahalmazhoz; nem mondja ki, hogy egy eltérő fájl AI-készítésű.

A két pontszám nem olvad össze automatikusan. Ellentmondás, kevés referencia vagy gyenge hangminőség esetén az alkalmazás emberi felülvizsgálatot javasol. A referenciafájlok a böngészőben maradnak; legalább öt, a vizsgált zenéhez műfajban és produkciós környezetben hasonló emberi mű ajánlott.

## Bizonyíték-triage és auditjegyzék

Minden elemzés egy helyben letölthető JSON auditjegyzéket is készít: SHA-256 fájlhash, fájlparaméterek, detektorverzió, mérési jellemzők, figyelmeztetések, bizonyítékrétegek és lehetséges alternatív magyarázatok. A C2PA-kompatibilis, olvasható manifestet a felület helyben ellenőrzi. A hiánya nem ellenbizonyíték: a fájlformátum vagy a böngésző is korlátozhatja az ellenőrzést. SynthID és stemszintű eredet továbbra sem ellenőrzött, ezért a rendszer ezeket nem állíthatja pozitívnak vagy negatívnak. A kimenet célja a szakértői felülvizsgálat előkészítése, nem jogi bizonyítás.

Az alkalmazás a gyakori ID3/RIFF-környéki konténeradatokban helyi szövegkereséssel jelzi a `made with suno` feliratot, UUID-ket és ISO-időbélyegeket. Ez **módosítható metadata**, nem kriptográfiai eredetigazolás és nem rejtett akusztikus vízjel. Emellett a 16,0 / 16,6 / 16,8 kHz körüli relatív, keskenysávú kiemeléseket kutatási jelzőként naplózza. Ezeket a rendszer generátori, codec- vagy mastering-artefaktumként kezeli, és nem számítja AI-pontszámba.

## Effektprofil-adatgyűjtés

A felület helyben tárolható, exportálható rekordokat készít későbbi plugin-/effektprofil-kutatáshoz. Egy rekord a fájl SHA-256 hash-ét, a felhasználó címkéit (forrás, effektcsalád, plugin/modell, tesztjel, beállításazonosító) és alapvető dinamikai/spektrális jellemzőket tartalmaz; magát a hangfájlt nem. A tanításhoz a hash alapján párosítsd a rekordokat a jogtisztán megőrzött eredeti hanganyaggal. Csak kontrollált, ismert forrású teszteket címkézz pozitív példaként - egy kész zenei részlet nem alkalmas biztos pluginazonosításra.

## Maradványdiagnosztika

Az alkalmazás kutatási jelleggel kimutatja a kevert hang HPSS-alapú harmonikus/perkusszív arányát, spektrális fluxát, maradvány-sávszélességét és a keskeny spektrális csúcsok időbeli fennmaradását. Ezek nem AI-bizonyítékok, nem stem-szintű ítéletek, és nem részei az AI-artefaktum kockázati pontszámnak.

A hibrid, AI-stem-szintű detektálás tervezett szerveroldali architektúrája: [hybrid-stem-roadmap.md](docs/hybrid-stem-roadmap.md). A felület kísérleti 6+1 stem-zajréteget is fogad: `vocals`, `drums`, `bass`, `guitar`, `piano`, `other` és külön `residual/noise` stem. Ezekben a spektrális laposságot, magasfrekvenciás arányt és egy összesített zajindexet méri a mixhez képest. Ez csak bizonyítékréteg; a szeparátor saját műterméke ugyanilyen jelet adhat.

A későbbi lokális szeparátor-szolgáltatás job-, cancel-, progress- és metaadatszerződése: [stem-service-contract.md](docs/stem-service-contract.md). A hat fő stem feltöltésekor a residualt a kliens is képezheti az illesztett mix és a hat stem különbségeként.

## ONNX és TypeScript alap

Az alkalmazás Vite-alapú fejlesztői és build-folyamatot, valamint TypeScript-ellenőrzést használ. Opcionálisan betölthető egy ONNX-modell és a hozzá tartozó JSON-kontraktus; a kontraktus expliciten megadja a bemenet nevét, a kimenet nevét és a feature-sorrendet. Ez csak helyi következtetést futtat, nem ad automatikusan hiteles AI-minősítést: ahhoz verziózott modellkártya, tanítóadat-leírás, küszöb és külső validáció kell. Stem-szeparáció nem indul el kompatibilis, licencelt szeparációs modell és hang-előfeldolgozási kontraktus nélkül.

## Beépített kutatási tanulságok

- **Fusion Segment Transformer (Kim & Go, 2026):** nem csak egy rövid ablakot, hanem több, a teljes dalon elosztott szegmenst vizsgálunk; ezekből önhasonlósági, szerkezeti diagnosztika készül. A publikáció Transformer- és beat-alapú modelljét nem lehet adat és tanítás nélkül hitelesen reprodukálni.
- **MusicDET (Han et al., 2026):** frekvenciasávonként kezeljük a jeleket, az alacsony, közép és magas sáv külön diagnosztikát kap. A normalizing-flow egyosztályos modellhez valós zene referencia-adatbázis szükséges.
- **Finding the Noise (Afchar & Hennequin, 2026):** a fakeprint-szerű, lokalizált spektrális csúcsok és azok periodicitása megmaradt a fő jelként; ezt többsávos eltéréssel egészítettük ki. Az NMF-alapú, teljesen zero-shot klaszterezéshez több fájl együttes elemzése szükséges, ezért következő fázis.
- **Music recognition based on diffractive neural networks (Ge et al., 2026):** a logaritmikus spektrális reprezentáció és a szegmens-alapú feldolgozás alkalmazható felismerési elv; az optikai hardver-architektúra ehhez a webes MVP-hez nem releváns.

## Következő lépés éles használathoz

1. Jogtisztán összeállított, generátoronként és műfajonként kiegyensúlyozott adatbázis.
2. Elkülönített tesztkészlet, illetve transzkódolási, mastering- és rövid-részlet robusztussági mérés.
3. Kalibrált ML/ONNX-osztályozó és verziózott küszöbértékek.
4. Human-in-the-loop felülvizsgálat a küszöb körüli vagy nagy következményű döntésekhez.

## Inspiráció és licencelés

Az architektúra kutatási inspirációja: Deezer ISMIR 2025 fakeprint/Fourier-megközelítés és a közösségi ONNX/CQT demók. A Deezer megvalósítása CC BY-NC 4.0 licencű; annak kódját, modelljét és súlyait ez a projekt nem használja. A referenciákat integrálás előtt egyenkénti licenc- és adatellenőrzésnek kell alávetni.
