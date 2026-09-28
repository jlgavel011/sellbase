// Entry of dist/sellbase.js: <script type="module" src="sellbase.js"></script>
import { defineElements, Sellbase } from './index.js';

declare global {
  interface Window {
    Sellbase?: typeof Sellbase;
  }
}

window.Sellbase = Sellbase;
defineElements();
