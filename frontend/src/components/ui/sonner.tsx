import { Toaster as Sonner, type ToasterProps } from 'sonner';

// Тости рендеримо семантичними токенами теми (bg-background/foreground/…),
// тож вони автоматично підхоплюють світлу/темну тему через клас `.dark`.
export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg',
          description: 'group-[.toast]:text-muted-foreground',
          actionButton:
            'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
          cancelButton:
            'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
          error:
            'group-[.toaster]:!bg-destructive group-[.toaster]:!text-white group-[.toaster]:!border-destructive',
        },
      }}
      {...props}
    />
  );
}
