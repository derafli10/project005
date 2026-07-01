"use client";

interface CreateClassFormProps {
  onClose: () => void;
  labels: {
    title: string;
    nameLabel: string;
    namePlaceholder: string;
    sksLabel: string;
    submit: string;
    cancel: string;
  };
}

export function CreateClassForm({ onClose, labels }: CreateClassFormProps): React.ReactNode {
  return (
    <div className="p-4 text-center">
      <h3 className="text-lg font-bold mb-4">{labels.title}</h3>
      <p className="text-sm text-zinc-500 mb-6">Form placeholder</p>
      <button
        type="button"
        onClick={onClose}
        className="rounded-full bg-zinc-100 px-4 py-2 text-xs font-semibold hover:bg-zinc-200 dark:bg-zinc-800"
      >
        {labels.cancel}
      </button>
    </div>
  );
}
