# Plan: LONGCUT

> *The opposite of a shortcut.* Een routeplanner voor lopers: kies A, kies B, kies je kilometers. De app maakt de omweg.

Status: **goedgekeurd: webapp (PWA), naam LONGCUT. Accentkleur nog te kiezen.** · 4 november 2026

---

## 1. Wat is het (in één zin)

Een webapp die een looproute berekent van punt A naar punt B (of een lus) met **exact de afstand die je opgeeft** (±3–5 %), via rustige wegen en paden, en die route exporteert als **GPX voor je Garmin**.

**Het is géén navigatie-app.** Je Garmin navigeert. LONGCUT plant alleen.

## 2. Voor wie

- **Gebruiker 1:** jij. Je loopt 4× per week volgens een schema, meestal 15–40 km (uitschieters tot 100 km), vertrekt meestal vanuit Nieuwkerken-Waas en loopt ook in Antwerpen en Gent. Je hebt een iPhone 15 en een Garmin Forerunner 970 (kaarten en afslag-per-afslag op courses). Routes komen nu via Komoot-sync of via GPX in Garmin Connect.
- **Daarna:** vrienden en familie, via een link.
- **Misschien later:** publiek. Daar houden we rekening mee, maar we bouwen er nu niets extra voor.

## 3. Hoe je het gebruikt (het hoofdscenario)

1. Open LONGCUT op je iPhone (icoon op je beginscherm).
2. **Start:** je huidige locatie (standaard), een adres, tikken op de kaart of een favoriet.
3. **Einde:** een adres (bv. je ouders), tikken op de kaart, een favoriet, of "zelfde als start" voor een lus.
4. **Afstand:** typ `25` (km).
5. Optioneel: zet de schakelaars *Groen* (parken en bossen) en *Onverhard OK* aan.
6. Tik op **Plan**. Na hooguit ~10 seconden zie je 1 hoofdroute met de afstand groot in beeld, plus 2 alternatieven om naar te swipen.
7. **Opnieuw** geeft een nieuwe set routes. **Bewaar** zet de route in je lijst.
8. **Export → GPX.** Het bestand komt in Bestanden. Via *Deel* stuur je het naar Garmin Connect, en dan staat het als course op je horloge.

## 4. Functies

### Versie 1 (dit bouwen we)

| # | Functie | Details |
|---|---|---|
| F1 | Kaart | Donkere kaart van België. Alle paden en wegels zichtbaar (OpenStreetMap-data). |
| F2 | Startpunt kiezen | GPS · adres zoeken · tikken op de kaart · favorieten |
| F3 | Eindpunt kiezen | Idem, plus "zelfde als start" (lus) |
| F4 | Afstand ingeven | In km, van 1 tot 100 |
| F5 | Route berekenen | A→B met de gekozen afstand, ±3–5 % (bij korte routes max. ~500 m), liever iets te lang dan te kort. Eén grote omweg, geen lusjes aan het begin of einde. Zo weinig mogelijk dubbele stukken. |
| F6 | Routevoorkeur | Altijd: paden, wegels en rustige wegen boven drukke wegen. Optioneel: *Groen* en *Onverhard OK*. |
| F7 | Resultaat | 1 hoofdroute en 2 alternatieven, afstand groot in beeld, knop *Opnieuw* |
| F8 | Onmogelijke afstand | Duidelijke melding als de gevraagde afstand korter is dan de kortste weg ("Kortste route is 10,4 km") |
| F9 | Opslaan | Routes en favoriete plaatsen bewaard op je toestel, zonder account |
| F10 | GPX-export | Downloaden voor Garmin Connect, Komoot, Strava, ... |
| F11 | Openen in Maps | Google Maps / Apple Maps (benadering, zie §7) |
| F12 | Hoogteprofiel | Nice-to-have: alleen als het weinig moeite kost |
| F13 | Installeerbaar | Op het beginscherm van iPhone, Android en pc, als een echte app |

### Later (niet nu)

- Fietsen (eigen routeprofiel, max. 200 km)
- Licht thema en automatisch thema
- Stukken van een route verslepen om ze aan te passen
- Tussenstops
- Andere landen
- Rekening houden met je eigen favoriete stukken, door je Strava- of Garmin-geschiedenis in te laden (zie §7)
- Rechtstreeks naar Garmin sturen met één knop (vraagt toelating van Garmin)

### Bewust NIET

Navigatie onderweg, accounts, advertenties, delen op sociale media, gamification en andere tierlantijntjes.

## 5. Techniek (gewone taal)

| Onderdeel | Keuze | Waarom |
|---|---|---|
| Soort app | **Webapp die je kan installeren (PWA)** | Eén app voor iPhone, Android en pc. Geen App Store en geen Apple-account van €99 per jaar nodig. Op de iPhone: Safari → Deel → *Zet op beginscherm*. Dan opent hij schermvullend met een eigen icoon. |
| Kaartdata | **OpenStreetMap** | Dezelfde bron als Komoot. In België zeer volledig, inclusief trage wegen, veldwegen en bospaden. In landelijk gebied vaak beter dan Google. |
| Routeberekening | **openrouteservice** (gratis, gratis API-sleutel), met de looproute-instelling die rustige en groene wegen verkiest | Gratis tot 2.000 berekeningen per dag. Eén LONGCUT-route kost er ongeveer 10–30, dus genoeg voor ~70+ routes per dag. |
| Adres zoeken | Gratis zoekdienst op basis van OpenStreetMap | Geen kosten |
| Hosting | **GitHub Pages** (gratis) | De code staat op je GitHub, de app krijgt een vast webadres |
| Code | TypeScript + React + MapLibre (kaart) | Goed onderhoudbaar en veel gebruikt. Ik schrijf het leesbaar, met korte uitleg. |
| Opslag | Op je toestel zelf | Geen account of server nodig |

**Totale kost: €0.** Je moet alleen zelf een gratis account aanmaken op openrouteservice.org voor de API-sleutel (2 minuten werk).

### Hoe de "omweg" berekend wordt (het hart van de app)

1. De app kijkt eerst wat de kortste route van A naar B is. Is die langer dan je gevraagde afstand, dan krijg je een melding (F8).
2. Daarna kiest de app 1 tot 3 tussenpunten op een **ellips rond A en B**. Hoe breder de ellips, hoe langer de route. Dat geeft vanzelf één grote omweg in plaats van lusjes.
3. De echte route wordt berekend via die tussenpunten en gemeten. Te kort of te lang? Dan wordt de ellips bijgesteld en opnieuw berekend, tot de route binnen de marge valt. Liever iets te lang.
4. Dit gebeurt voor verschillende varianten: links van A–B, rechts, in een andere vorm. Elke kandidaat krijgt een score: afwijking van de afstand, dubbele stukken, aandeel drukke wegen, en eventueel aandeel groen.
5. De beste wordt de hoofdroute, de volgende twee zijn de alternatieven.

Voor een lus (A = B) gebruikt de app hetzelfde idee met punten rond de start.

## 6. Stijl

- **Minimalistisch, bold, clean.** Denk aan Runna, met meer karakter.
- **Kleuren:** diep antraciet (`#121214`, geen puur zwart), lichtgrijze tekst, met één felle accentkleur, voorstel **volt-geel/lime** (`#D7FF3A`). Die kleur gebruiken we voor de route, de knop *Plan* en de afstand.
- **Typografie:** grote, dikke cijfers voor de afstand ("**25.3** km"). Verder sobere, strakke tekst.
- **Alleen donker thema** voorlopig.
- **Eenhandig:** alle bediening onderaan het scherm, binnen bereik van je duim. De kaart vult de rest.
- **Taal:** Engels.
- **Naam:** **LONGCUT**. Alternatieven als je die niet goed vindt: **DTOUR**, **FARWAY**, **STRETCH**.

## 7. Grenzen en eerlijke kanttekeningen

- **Google Maps als databron:** niet gratis (tot een bepaald aantal per maand wel, daarboven betalend), het mag niet geëxporteerd worden naar GPX, en het kent minder veldwegen dan OpenStreetMap. Daarom OpenStreetMap.
- **Strava-populariteit:** Strava stelt zijn heatmap niet open voor andere apps. Wat wel kan: paden die in OpenStreetMap als wandel- of knooppuntroute staan, krijgen voorrang (dat zijn meestal de mooie stukken). Later kunnen we je eigen Strava- of Garmin-geschiedenis inladen, zodat de app stukken verkiest die jij vaak loopt.
- **Naar Google of Apple Maps sturen:** die apps aanvaarden maar een beperkt aantal tussenpunten via een link. De route daar zal dus *ongeveer* dezelfde zijn, niet exact. GPX naar Garmin is wel exact.
- **GPX naar Garmin op de iPhone:** volgens gebruikers lukt dit via *Bestanden → Deel → Connect*. Garmin documenteert dat niet officieel, dus testen we het op jouw toestel. Lukt het niet, dan werkt importeren via connect.garmin.com op de pc altijd.
- **Nauwkeurigheid:** ±3–5 % lukt bijna altijd in gebied met veel wegen, zoals het Waasland. In gebieden met weinig paden (bv. langs de Schelde of de haven) kan het moeilijker zijn. Dan toont de app eerlijk hoeveel de route afwijkt.

## 8. Wanneer is het af?

Versie 1 is af als:

1. Je **een week lang** elke looptraining kan plannen naar verschillende bestemmingen, met de afstand uit je schema.
2. Elke route **max. 3–5 % afwijkt** (bij korte routes max. ~500 m) en meestal iets langer is dan gevraagd.
3. De routes er **logisch** uitzien: één omweg, weinig dubbele stukken, vooral paden en rustige wegen.
4. Een route berekenen **binnen ~10 seconden** lukt.
5. Je elke keer **zonder problemen** de GPX op je iPhone krijgt, naar Garmin Connect stuurt en erop navigeert.
6. Het werkt op je **iPhone, op je pc** en op de Android-toestellen van vrienden.

## 9. Werkwijze in fases

Ik test elke fase zelf grondig voor ik ze toon. Na elke fase krijg je een tussenresultaat om bij te sturen.

| Fase | Wat | Jij krijgt te zien |
|---|---|---|
| **0. Opzet** | GitHub-repo, API-sleutel, basisproject | Een link naar een lege app die online staat |
| **1. Het algoritme** | De omweg-berekening, los getest op ~30 echte trajecten in het Waasland, Antwerpen en Gent (5–100 km) | Een **testrapport**: per traject de gevraagde en echte afstand, de afwijking en een kaartje. Hier controleren we het belangrijkste deel. |
| **2. Kernapp** | Kaart, punten kiezen, km, Plan, 3 routes, GPX-download | Een werkende (nog sobere) app op pc en gsm |
| **3. Design** | Volledige LONGCUT-stijl, eenhandig, installeerbaar | De app zoals hij eruit zal zien |
| **4. Opslaan en export** | Favorieten, bewaarde routes, Maps-links, hoogteprofiel (als het lukt) | Volledige versie 1 |
| **5. Praktijktest** | Jij test een week. Ik los op wat er misloopt. | Versie 1 af ✔ |

## 10. Nog open

- **Accentkleur:** twijfel bij volt-geel. Kandidaten: volt `#D7FF3A`, signaaloranje `#FF5B1F`, elektrisch blauw `#3D7BFF`, mint `#2EF2A6`, koraalrood `#FF3D5A`. Kiezen ten laatste in fase 3, met een voorbeeld naast elkaar.
- **Te doen door Dauwe vóór fase 0/1:** openrouteservice-sleutel, lege GitHub-repo `longcut` + Claude-toegang, netwerktoegang van de cloudomgeving.
