import { playAngelicChime, resumeAudio } from './audio';

// Name click → avatar pops in next to the name and gives a thumbs-up + wink.
// Total animation = 2s play + 1s hold/fade.
const NAME_AVATAR_TOTAL_MS = 3000;

export function initNameReveal() {
  const nameInner = document.querySelector<HTMLElement>('.resume-name-inner');
  const nameAvatar = nameInner?.querySelector<HTMLElement>('.name-avatar') ?? null;
  if (!nameInner || !nameAvatar) return;

  let timer: number | null = null;

  nameInner.addEventListener('click', () => {
    resumeAudio();
    if (timer !== null) {
      window.clearTimeout(timer);
      nameAvatar.classList.remove('is-playing');
      // Force reflow so re-adding the class restarts the animation.
      void nameAvatar.offsetHeight;
    }
    nameAvatar.classList.add('is-playing');
    playAngelicChime();
    timer = window.setTimeout(() => {
      nameAvatar.classList.remove('is-playing');
      timer = null;
    }, NAME_AVATAR_TOTAL_MS);
  });
}
