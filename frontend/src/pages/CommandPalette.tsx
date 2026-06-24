import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from '@/lib/router';
import { listProjects, type Project } from '@/lib/projects';
import { listMyOrganizations, type Organization } from '@/lib/organizations';
import { setActiveOrg } from '@/lib/account';

interface Item {
  type: 'org' | 'project';
  id: string;
  label: string;
  sub: string;
  orgId: string;
}

export function CommandPalette() {
  const { navigate } = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Cmd/Ctrl+K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('open-command-palette', onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('open-command-palette', onOpen);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setIndex(0);
    Promise.all([listMyOrganizations(), listProjects()])
      .then(([o, p]) => {
        setOrgs(o);
        setProjects(p);
      })
      .catch(() => undefined);
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  const items: Item[] = useMemo(() => {
    const orgItems: Item[] = orgs.map((o) => ({
      type: 'org',
      id: o.id,
      label: o.name,
      sub: o.type,
      orgId: o.id,
    }));
    const projItems: Item[] = projects.map((p) => ({
      type: 'project',
      id: p.id,
      label: p.name,
      sub: p.organization?.name ?? 'project',
      orgId: p.organizationId ?? p.organization?.id ?? '',
    }));
    const all = [...projItems, ...orgItems];
    const q = query.trim().toLowerCase();
    const filtered = q
      ? all.filter(
          (i) =>
            i.label.toLowerCase().includes(q) ||
            i.sub.toLowerCase().includes(q),
        )
      : all;
    return filtered.slice(0, 25);
  }, [query, orgs, projects]);

  const go = useCallback(
    async (item: Item) => {
      setOpen(false);
      if (item.orgId) await setActiveOrg(item.orgId).catch(() => undefined);
      if (item.type === 'org') navigate(`/orgs/${item.orgId}/projects`);
      else navigate(`/orgs/${item.orgId}/projects/${item.id}`);
    },
    [navigate],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-24"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setIndex((i) => Math.min(i + 1, items.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setIndex((i) => Math.max(i - 1, 0));
            } else if (e.key === 'Enter' && items[index]) {
              void go(items[index]);
            }
          }}
          placeholder="Search projects and organizations…"
          className="w-full border-b bg-transparent px-4 py-3 text-sm outline-none"
        />
        <div className="max-h-80 overflow-auto py-1">
          {items.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">
              No matches.
            </p>
          ) : (
            items.map((item, i) => (
              <button
                key={`${item.type}:${item.id}`}
                onClick={() => void go(item)}
                onMouseEnter={() => setIndex(i)}
                className={`flex w-full items-center justify-between px-4 py-2 text-left text-sm ${
                  i === index ? 'bg-muted' : ''
                }`}
              >
                <span className="flex items-center gap-2">
                  <span className="w-14 text-xs uppercase text-muted-foreground">
                    {item.type}
                  </span>
                  <span className="font-medium">{item.label}</span>
                </span>
                <span className="text-xs text-muted-foreground">{item.sub}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
