import { playAngelicChime, resumeAudio } from '../lib/audio';
import { markDiscovered } from '../lib/discoveries';
import { end, tryStart } from '../lib/interaction-lock';

// Name click → avatar pops in next to the name and gives a thumbs-up + wink.
// Total animation = 2s play + 1s hold/fade.
const NAME_AVATAR_TOTAL_MS = 3000;
const LOCK_ID = 'name-reveal';

export function initHeader() {
  const nameInner = document.querySelector<HTMLElement>('.resume-name-inner');
  const nameAvatar = nameInner?.querySelector<HTMLElement>('.name-avatar') ?? null;
  if (!nameInner || !nameAvatar) return;

  let timer: number | null = null;

  nameInner.addEventListener('click', () => {
    if (!tryStart(LOCK_ID)) return;
    markDiscovered('name');
    resumeAudio();
    nameAvatar.classList.add('is-playing');
    playAngelicChime();
    timer = window.setTimeout(() => {
      nameAvatar.classList.remove('is-playing');
      timer = null;
      end(LOCK_ID);
    }, NAME_AVATAR_TOTAL_MS);
  });
}
