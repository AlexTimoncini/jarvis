/* Quick links widget - decorative HUD chips (no navigation yet). */
const ITEMS = ['MAIL', 'METEO', 'MUSICA', 'MAPPE', 'NOTE', 'SISTEMA', 'RETE', 'ENERGIA'];

export class Links {
  constructor(root) {
    this.root = root;
    root.innerHTML = '';
    for (const label of ITEMS) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'link-chip';
      chip.textContent = label;
      root.appendChild(chip);
    }
  }
}
