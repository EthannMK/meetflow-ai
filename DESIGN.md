---
system_name: "MeetFlow Enterprise — Acoustic & Execution Intelligence"
generator: "Google Stitch Design System Specification v2.0"
aesthetic_persona: "Atmospheric Minimalism & High-Craft Enterprise UI"
brand_inspirations:
  - "Linear (Keyboard-first precision, hairline dividers, monospace task telemetry)"
  - "Granola / Otter Enterprise (Time-coded verbatim transcript ledger, inline utterance-to-task actions)"
  - "Google Cloud Console & Attio (High-density data tables, structured inspector drawers, dual-theme polarity)"
color_polarity: "Dual Adaptive (Carbon Obsidian Dark Default + Alabaster Enterprise Light)"
typography:
  sans: "'Inter', 'Noto Sans Myanmar', -apple-system, BlinkMacSystemFont, sans-serif"
  mono: "'JetBrains Mono', monospace"
grid_unit: "4px"
---

# MeetFlow Enterprise — `DESIGN.md` Source of Truth

## 1. Design Philosophy & Anti-Vibecode Mandate
This specification governs every screen, component, and interaction in **MeetFlow Enterprise**.
- **Strict Ban on Decorative Emojis**: Emojis (`🎙️`, `📋`, `🔥`, etc.) are strictly prohibited in navigation chrome, buttons, badges, and status indicators. All iconography must use precision `1.5px` stroke vector SVGs (`16x16` or `14x14` viewBox).
- **Whisper-Quiet Luxury & Scannable Hierarchy**: Depth is achieved through subtle surface luminance steps, `1px` hairline borders, and tabular typography—never heavy drop shadows, neon gradients, or oversized rounded boxes.
- **Zero-Burden Execution Flow**: Every spoken utterance in a meeting is treated as structured enterprise data that can be converted into a tracked project deliverable with a single click or automated AI extraction.

---

## 2. Design Tokens (Color & Surface Architecture)

### Carbon Obsidian Dark Mode (Default)
| Token | Value | Usage |
| :--- | :--- | :--- |
| `--bg-canvas` | `#09090B` | Root application background (Zinc 950) |
| `--bg-surface-1` | `#111114` | Sidebar, global header, and secondary panels |
| `--bg-surface-2` | `#16161A` | Primary elevated cards, table rows, and modals |
| `--bg-surface-3` | `#1E1E24` | Interactive hover states, active pills, input fields |
| `--border-subtle` | `#232329` | Primary `1px` structural hairline divider |
| `--border-strong` | `#32323C` | Focused input borders and active card outlines |
| `--text-primary` | `#F4F4F6` | Headings, active navigation, transcript speech |
| `--text-secondary` | `#A1A1AA` | Metadata, table cells, secondary descriptions |
| `--text-muted` | `#63636E` | Micro-labels, timestamps, keyboard shortcut hints |
| `--accent-primary` | `#3B82F6` | Enterprise Cobalt Blue for primary actions & active indicators |
| `--accent-claude` | `#D97757` | Anthropic Terracotta for Claude Pro Bridge workflows |
| `--status-rec` | `#EF4444` | Active acoustic capture & high-priority alerts |
| `--status-ok` | `#10B981` | Offline Whisper ready, connected OAuth, completed tasks |
| `--status-warn` | `#F59E0B` | Medium priority, pending sync, in-progress states |

### Alabaster Daylight Mode (`[data-theme="light"]`)
| Token | Value | Usage |
| :--- | :--- | :--- |
| `--bg-canvas` | `#F8FAFC` | Crisp daylight background |
| `--bg-surface-1` | `#F1F5F9` | Sidebar & structural chrome |
| `--bg-surface-2` | `#FFFFFF` | Cards, ledger sheets, and inspector drawers |
| `--bg-surface-3` | `#E2E8F0` | Hover states & subtle controls |
| `--border-subtle` | `#E2E8F0` | Structural hairline dividers |
| `--border-strong` | `#CBD5E1` | Active borders |
| `--text-primary` | `#0F172A` | Deep slate ink |
| `--text-secondary` | `#475569` | Neutral slate body |
| `--text-muted` | `#94A3B8` | Captions & timestamps |

---

## 3. Typography & Myanmar (`မြန်မာ`) Script Harmony
- **UI & Prose (`--font-sans`)**: `Inter` paired with `Noto Sans Myanmar` so English and Burmese Unicode script share identical optical baseline alignment and line-height (`1.55` for English, `1.7` automatic breathing room for Myanmar stacked consonants/diacritics).
- **Telemetry & Timestamps (`--font-mono`)**: `JetBrains Mono` with `font-variant-numeric: tabular-nums` for recording timers (`00:14:22`), dB audio meters (`-12.4 dB`), task IDs (`MF-104`), and transcript timestamps (`[01:18]`).
- **Micro-Headers**: `11px` (`0.6875rem`), `font-weight: 600`, `text-transform: uppercase`, `letter-spacing: 0.06em`, `color: var(--text-muted)`.

---

## 4. Layout & Spatial Architecture
1. **Global Command Topbar (`48px` fixed height)**:
   - Breadcrumb navigation (`Workspace / View`)
   - Centered **Command Palette Trigger (`Ctrl+K`)**
   - Right-aligned **Live ASR Telemetry Pill**, **Theme Polarity Switch**, and **Floating PiP Window Trigger**.
2. **Collapsible Enterprise Rail (`236px` fixed width)**:
   - Sectioned navigation with SVG icons, active `2px` left indicator bar, live counters, and direct **Project Filter Switcher**.
3. **3-Zone Live Acoustic Studio**:
   - **Top Acoustic Telemetry Deck**: Dual-channel peak meter (`CH1 Mic` + `CH2 System/Tab Audio`), real-time frequency canvas, ASR pipeline selector, and `EN` / `MY` hot-swap control.
   - **Center Verbatim Ledger**: Filterable, time-coded transcript rows with hover action toolbar (`+ Create Task`, `Mark Decision`, `Flag Risk`).
   - **Right Contextual Inspector**: Tabbed drawer switching between **Live Scratchpad**, **Executive Synthesis**, and **Synced PM Deliverables**.
4. **Slide-Over Task Context Drawer**:
   - Clicking any task opens a right-hand inspector showing full task metadata and the **exact verbatim meeting quote & timestamp** where the action item was born.
