# Slovak Railways Redesign

Bachelor thesis showcase by **Dalibor Itze** for a new livery, wayfinding system, and modular coating language for **Železničná spoločnosť Slovensko** (ZSSK). The site is bilingual (English and Slovak) and includes an interactive 3D train builder.

This is an independent student project. It is not an official ZSSK release.

**Best in Design 2025**, Zlin Design Week — overall winner across 540+ entries, and first place in Communication Design. Award ceremony: 10 May 2025, Zlín.
[Announcement](https://zlindesignweek.com/2026/en/2025/05/12/best-in-design-2025-award-and-e1500-prize-go-to-slovakia-dalibor-itze-wins-with-slovak-railways-redesign/)

Video: [Slovak Railways Redesign on YouTube](https://www.youtube.com/watch?v=WDghfP8oXvU)

Author: [Dalibor Itze](https://byitze.com/) · [Studio Asymetric](https://asymetric.studio)

![Fleet overview, old livery beside the redesign](<public/other/renders/oldnew wide grain.jpg>)

## What the project is

ZSSK rolling stock has carried several unrelated colour schemes. The thesis proposes one modular coating system that can sit on locomotives, electric units, diesel units, and coaches without each vehicle becoming a separate brand.

The showcase walks through that work:

| Section | What it covers |
| --- | --- |
| The new liveries | Renders of the proposed coating on the real fleet |
| Why redesign? | How Slovak and Czechoslovak liveries got to the current mix |
| Wayfinding and signage | Pictograms, type, and passenger information |
| Inspiration abroad | Railjet, Cityjet, České dráhy, and related systems |
| 3D train builder | Assemble a consist from the modelled vehicles |
| Sources and thanks | Literature, and the people who advised the thesis |

Advisers credited in the project: Daniel Blonski (2008 ZSSK livery), Ondrej Jób (Setup Type), Daniel Huber (moodley, Railjet and Cityjet), and Pavel Noga (UTB Zlín).

![Proposed locomotive family](<public/other/renders/Redizajn železničnej spoločnosti Slovensko, Dalibor Itze - lokomotívy.jpg>)

![Stadler KISS in the new livery](<public/other/renders/Redizajn železničnej spoločnosti Slovensko, Dalibor Itze - Stadler KISS.jpg>)

![Tatra electric units](<public/other/renders/Redizajn železničnej spoločnosti Slovensko, Dalibor Itze - tatranské električky.jpg>)

![UIC coaches](<public/other/renders/Redizajn železničnej spoločnosti Slovensko, Dalibor Itze - UIC vozne.jpg>)

The full render set lives in `public/other/renders/`.

## Stack

| Layer | Choice |
| --- | --- |
| Build | Vite 5 |
| 3D | Three.js — GLB modules, Draco, HDR lighting, bloom |
| Scroll | Lenis |
| Type | Instrument Sans and Instrument Serif, from Google Fonts (SIL OFL, not vendored). The file at `public/fonts/ZSSK variable-VF.ttf` is a small icon font the page already loads |
| Runtime | Static files behind nginx |

The builder treats each vehicle as a module (`models/*.glb`): locomotives, KISS, Panter, DMUs, Tatra trams, and UIC coaches. Thumbnails for the picker are in `assets/`.

## Develop

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # dist/
npm run preview
```

## Deploy on Coolify (GitHub App)

Production is a static Vite build copied into `nginx:1.27-alpine`. Pushing `main` is the deploy.

```text
GitHub main push
    → Coolify GitHub App webhook
    → docker build (Node 22 build, nginx runtime)
    → nginx serves /usr/share/nginx/html on port 80
```

No database, no environment variables, no persistent volume.

Local check:

```bash
docker build -t slovak-railways-redesign .
docker run --rm -p 8080:80 slovak-railways-redesign
```

### Coolify application

| Item | Value |
| --- | --- |
| Source | GitHub App → `studio-asymetric/slovak-railways-redesign` |
| Branch | `main` |
| Build pack | **Dockerfile** (repository root) |
| Port | **80** |
| Domain | `zssk.asymetric.studio` |
| Environment | none |
| Volumes | none |
| Auto deploy | on |

TLS is issued by Coolify / Traefik. Container nginx only listens on port 80.

### DNS

The `asymetric.studio` zone still has a legacy wildcard. A specific record has to override it, or the hostname stays on the old server and Coolify never sees the request.

| Type | Host | Target |
| --- | --- | --- |
| A | `zssk` | `157.90.175.53` |

Registrar: Wedos. Same VPS as the rest of Studio Asymetric (`ops.asymetric.studio`).

### First-time checklist

1. Coolify → Sources → GitHub App, and grant this public repository.
2. New Application from `studio-asymetric/slovak-railways-redesign`, branch `main`, build pack **Dockerfile**.
3. Set the container port to **80**.
4. Add domain `zssk.asymetric.studio` and turn HTTPS on.
5. Turn Auto Deploy on.
6. Add the Wedos A record above, then open the site and the train builder.

If Coolify cannot see the repository, the GitHub App has not been granted access to it. If a push does not update the site, Auto Deploy is off or the build failed — check the deploy log and redeploy.

## Licence

| Part | Licence |
| --- | --- |
| Website code | MIT |
| Original models, livery renders, diagrams, and interface graphics | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |

Credit Dalibor Itze when you reuse the models or the livery renders.

The SIL Open Font License applies to font software. This repository does not contain a ZSSK text face to release under it. `public/fonts/ZSSK variable-VF.ttf` is the small file the stylesheet already points at; its internal name is SchooToGo variable icons, so it is not relicensed here. Instrument Sans and Instrument Serif stay on the SIL licence they already have from Google Fonts.

Reference photographs, environment maps, and third-party trademarks are not relicensed. Details are in [LICENSE](LICENSE).

## Repository layout

```text
index.html          Page
src/                Three.js scene, showcase UI, styles
models/             GLB modules for the train builder
assets/             Thumbnails, logo, interface drawings
public/             Content pages, research images, livery renders, font
public/fonts/       Font file the stylesheet loads
Dockerfile          Node build → nginx
nginx.conf          Static hosting, port 80
```
