/**
 * Cropped pictures of the control each step is about. Drawn rather than
 * photographed so the highlighted row stays accurate as the page is themed.
 */

export type InstallPlatform = "iphone" | "android" | "computer";
export type InstallTask = "install" | "save";

export function InstallShot({
  platform,
  task,
}: {
  platform: InstallPlatform;
  task: InstallTask;
}) {
  const caption =
    platform === "computer"
      ? task === "install"
        ? "Drag Save to Stash onto the bookmarks bar."
        : "Click Save to Stash on the article you want to keep."
      : platform === "iphone"
        ? task === "install"
          ? "Add to Home Screen is in the share sheet."
          : "Stash is in the row of apps on the share sheet."
        : task === "install"
          ? "Install app is in Chrome’s menu."
          : "Stash is in the share sheet.";

  return (
    <figure className="mt-4" data-testid={`install-shot-${task}`}>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {platform === "iphone" && <IosSheet task={task} />}
        {platform === "android" &&
          (task === "install" ? <AndroidMenu /> : <AndroidShare />)}
        {platform === "computer" && <BrowserShot task={task} />}
      </div>
      <figcaption className="mt-2 text-xs text-slate-500">{caption}</figcaption>
    </figure>
  );
}

function IosSheet({ task }: { task: InstallTask }) {
  const apps = [
    { label: "Messages", mark: "M", color: "bg-green-500" },
    { label: "Mail", mark: "✉", color: "bg-sky-500" },
    {
      label: "Stash",
      mark: "S",
      color: "bg-violet-600",
      highlighted: task === "save",
    },
    { label: "Notes", mark: "N", color: "bg-amber-400" },
  ];

  return (
    <div className="bg-slate-200/80 p-3 pt-8">
      <div className="rounded-2xl bg-slate-100 px-3 pb-3 pt-2">
        <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-slate-300" />
        <div className="flex gap-3">
          {apps.map((app) => (
            <div key={app.label} className="flex w-14 flex-col items-center gap-1">
              <div
                className={`flex h-12 w-12 items-center justify-center rounded-[14px] text-base font-semibold text-white ${app.color} ${
                  app.highlighted ? "ring-2 ring-violet-600 ring-offset-2" : ""
                }`}
              >
                {app.mark === "✉" ? (
                  <MailMark />
                ) : (
                  app.mark
                )}
              </div>
              <span
                className={`text-[11px] ${
                  app.highlighted
                    ? "font-semibold text-violet-700"
                    : "text-slate-600"
                }`}
              >
                {app.label}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-3 overflow-hidden rounded-xl bg-white">
          <SheetRow label="Copy" />
          <SheetRow label="Add to Reading List" />
          <SheetRow label="Add to Home Screen" highlighted={task === "install"} />
        </div>
      </div>
    </div>
  );
}

function SheetRow({
  label,
  highlighted = false,
}: {
  label: string;
  highlighted?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-3 border-t border-slate-100 px-3 py-2.5 text-sm first:border-t-0 ${
        highlighted ? "bg-violet-100 font-semibold text-violet-800" : "text-slate-800"
      }`}
    >
      <span className="h-4 w-4 rounded bg-slate-200" />
      {label}
    </div>
  );
}

function AndroidMenu() {
  return (
    <div>
      <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
        <div className="h-8 min-w-0 flex-1 truncate rounded-full border border-slate-200 bg-white px-3 text-xs leading-8 text-slate-400">
          stash.example
        </div>
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-100">
          <Dots />
        </div>
      </div>
      <div className="bg-white py-1">
        <MenuRow label="New tab" />
        <MenuRow label="Bookmarks" />
        <MenuRow label="Install app" highlighted />
        <MenuRow label="Settings" />
      </div>
    </div>
  );
}

function AndroidShare() {
  const apps = [
    { label: "Messages", color: "bg-green-500", mark: "M" },
    { label: "Gmail", color: "bg-red-500", mark: "G" },
    { label: "Stash", color: "bg-violet-600", mark: "S", highlighted: true },
    { label: "Drive", color: "bg-amber-500", mark: "D" },
  ];
  return (
    <div className="bg-slate-100 px-4 pb-4 pt-3">
      <p className="text-sm font-medium text-slate-900">Share</p>
      <div className="mt-3 grid grid-cols-4 gap-2">
        {apps.map((app) => (
          <div key={app.label} className="flex flex-col items-center gap-1">
            <div
              className={`flex h-12 w-12 items-center justify-center rounded-full text-base font-semibold text-white ${app.color} ${
                app.highlighted ? "ring-2 ring-violet-600 ring-offset-2" : ""
              }`}
            >
              {app.mark}
            </div>
            <span
              className={`text-[11px] ${
                app.highlighted ? "font-semibold text-violet-700" : "text-slate-600"
              }`}
            >
              {app.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MenuRow({
  label,
  highlighted = false,
}: {
  label: string;
  highlighted?: boolean;
}) {
  return (
    <div
      className={`px-4 py-2.5 text-sm ${
        highlighted ? "bg-violet-100 font-semibold text-violet-800" : "text-slate-800"
      }`}
    >
      {label}
    </div>
  );
}

function BrowserShot({ task }: { task: InstallTask }) {
  return (
    <div>
      <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-100 px-3 py-2">
        <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
        <div className="ml-1 h-7 min-w-0 flex-1 truncate rounded-md border border-slate-200 bg-white px-2 text-xs leading-7 text-slate-400">
          https://example.com/article
        </div>
      </div>
      <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
        <BookmarkChip label="News" />
        <BookmarkChip label="Mail" />
        {task === "save" ? (
          <BookmarkChip label="Save to Stash" highlighted />
        ) : (
          <span className="rounded-md border border-dashed border-violet-400 bg-violet-50 px-2 py-1 text-xs font-medium text-violet-700">
            Drop here
          </span>
        )}
      </div>
      {task === "install" ? (
        <div className="relative h-28 bg-slate-50">
          <svg
            viewBox="0 0 280 90"
            className="absolute inset-x-0 top-0 h-full w-full text-violet-600"
            aria-hidden
          >
            <path
              d="M70 78 C90 40, 200 36, 236 22"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            />
            <path d="M226 16 l16 4 -8 12" fill="currentColor" stroke="none" />
          </svg>
          <div className="absolute bottom-4 left-6 rounded-md border border-violet-600 bg-white px-3 py-1.5 text-sm font-medium text-slate-800">
            Save to Stash
          </div>
        </div>
      ) : (
        <div className="bg-white px-4 py-4">
          <div className="h-3 w-2/3 rounded bg-slate-200" />
          <div className="mt-3 h-2 w-full rounded bg-slate-100" />
          <div className="mt-1.5 h-2 w-5/6 rounded bg-slate-100" />
          <div className="mt-1.5 h-2 w-4/6 rounded bg-slate-100" />
        </div>
      )}
    </div>
  );
}

function BookmarkChip({
  label,
  highlighted = false,
}: {
  label: string;
  highlighted?: boolean;
}) {
  return (
    <span
      className={`rounded-md border px-2 py-1 text-xs font-medium ${
        highlighted
          ? "border-violet-600 bg-violet-50 text-violet-800 ring-2 ring-violet-600"
          : "border-slate-200 bg-white text-slate-700"
      }`}
    >
      {label}
    </span>
  );
}

function Dots() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 text-violet-700" aria-hidden>
      <circle cx="12" cy="5" r="1.6" fill="currentColor" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
      <circle cx="12" cy="19" r="1.6" fill="currentColor" />
    </svg>
  );
}

function MailMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="white" strokeWidth="1.8" aria-hidden>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="m4 7 8 6 8-6" />
    </svg>
  );
}
