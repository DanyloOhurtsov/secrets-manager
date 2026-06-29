import { toast } from 'sonner';

// Перетворює помилку API на людяне повідомлення. Сирий бекендовий текст на кшталт
// "Missing permission: createSecrets" замінюємо на зрозумілу фразу.
export function friendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : 'Something went wrong';
  if (msg.startsWith('Missing permission')) {
    return "You don't have permission to do that.";
  }
  return msg;
}

// Показує помилку тостом Sonner (замість інлайнового тексту).
export function notifyError(err: unknown): void {
  toast.error(friendlyError(err));
}
