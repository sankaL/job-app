import { ActionButtons } from "@/components/ui/button-group";
import { Card } from "@astryxdesign/core/Card";
import { ClickableCard } from "@astryxdesign/core/ClickableCard";
import { Grid } from "@astryxdesign/core/Grid";
import { LinkProvider } from "@astryxdesign/core/Link";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Token } from "@astryxdesign/core/Token";
import {
  forwardRef,
  useDeferredValue,
  useState,
  type ComponentPropsWithoutRef,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { Pencil, Search, Star, Trash2 } from "lucide-react";
import { ResumeDocumentArtwork } from "@/components/ResumeDocumentArtwork";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";
import { SkeletonSection } from "@/components/ui/skeleton";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { useToast } from "@/components/ui/toast";
import {
  deleteBaseResume,
  setDefaultBaseResume,
  type BaseResumeSummary,
} from "@/lib/api";
import {
  invalidateBaseResumeQueries,
  useBaseResumesQuery,
} from "@/lib/queries";

const ResumeCardLink = forwardRef<
  HTMLAnchorElement,
  ComponentPropsWithoutRef<"a">
>(function ResumeCardLink({ href = "", ...props }, ref) {
  return <Link {...props} ref={ref} to={href} />;
});

type ResumeCardProps = {
  resume: BaseResumeSummary;
  busy: boolean;
  onEdit: () => void;
  onSetDefault: () => void;
  onDelete: () => void;
};

function ResumeActions({
  resume,
  busy,
  onEdit,
  onSetDefault,
  onDelete,
}: ResumeCardProps) {
  return (
    <HStack gap={1} vAlign="center" hAlign="end" className="ml-auto shrink-0">
      <ActionButtons label="Resume actions" size="sm" primaryIndex={resume.is_default ? 0 : 1}>
        {!resume.is_default && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={onSetDefault}
          >
            Set Default
          </Button>
        )}
        <IconButton
          onClick={onEdit}
          aria-label={`Edit ${resume.name}`}
          title="Edit resume"
        >
          <Pencil size={16} aria-hidden="true" />
        </IconButton>
        <IconButton
          variant="danger"
          aria-label={`Delete ${resume.name}`}
          title="Delete resume"
          disabled={busy}
          onClick={onDelete}
        >
          <Trash2 size={16} aria-hidden="true" />
        </IconButton>

      </ActionButtons>
</HStack>
  );
}

// Astryx documentation template: transparent clickable tiles, muted previews,
// then a name and supporting text. Nested actions retain their own targets.
function formatResumeDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function ResumeCard(props: ResumeCardProps) {
  const { resume } = props;
  return (
    <ClickableCard
      label={`Open ${resume.name}`}
      href={`/app/resumes/${resume.id}`}
      variant="transparent"
      padding={2}
    >
      <VStack gap={4} height="fill">
        <Card
          variant="muted"
          padding={0}
          className="rounded-lg overflow-hidden"
        >
          <ResumeDocumentArtwork />
        </Card>
        <VStack gap={2}>
          <HStack gap={2} vAlign="center" hAlign="between">
            <Text
              type="large"
              weight="semibold"
              className="min-w-0"
              maxLines={2}
            >
              {resume.name}
            </Text>
            {resume.is_default && (
              <Token
                label="Default"
                color="blue"
                size="md"
                icon={<Star size={14} fill="currentColor" aria-hidden="true" />}
                className="shrink-0 rounded-full"
              />
            )}
          </HStack>
          <VStack minHeight={60}>
            <Text type="body" color="secondary" maxLines={3}>
              {resume.summary || "No summary added yet."}
            </Text>
          </VStack>
        </VStack>
        <HStack gap={2} vAlign="center" hAlign="between" wrap="wrap">
          <HStack gap={5}>
            <VStack gap={1}>
              <Text type="supporting" color="secondary">
                Updated
              </Text>
              <Text type="supporting" color="primary" weight="medium">
                {formatResumeDate(resume.updated_at)}
              </Text>
            </VStack>
            <VStack gap={1}>
              <Text type="supporting" color="secondary">
                Created
              </Text>
              <Text type="supporting" color="primary" weight="medium">
                {formatResumeDate(resume.created_at)}
              </Text>
            </VStack>
          </HStack>
          <ResumeActions {...props} />
        </HStack>
      </VStack>
    </ClickableCard>
  );
}

function BaseResumeContent({
  resumes,
  filteredResumes,
  actionInProgress,
  onCreate,
  onEdit,
  onSetDefault,
  onDelete,
}: {
  resumes: BaseResumeSummary[] | undefined;
  filteredResumes: BaseResumeSummary[];
  actionInProgress: string | null;
  onCreate: (mode: "upload" | "blank") => void;
  onEdit: (id: string) => void;
  onSetDefault: (id: string) => void;
  onDelete: (resume: BaseResumeSummary) => void;
}) {
  if (!resumes)
    return (
      <Grid columns={{ minWidth: 320 }} gap={2}>
        {Array.from({ length: 3 }, (_, index) => (
          <SkeletonSection key={index} />
        ))}
      </Grid>
    );
  if (resumes.length === 0)
    return (
      <EmptyState
        title="No resumes yet"
        description="Upload a PDF or start from scratch to create your first base resume. These serve as the foundation for tailoring job-specific applications."
        action={
          <HStack gap={2} wrap="wrap">
            <ActionButtons label="Create a resume" size="sm">
              <Button variant="secondary" onClick={() => onCreate("upload")}>
                Upload PDF
              </Button>
              <Button onClick={() => onCreate("blank")}>
                Start from Scratch
              </Button>

            </ActionButtons>
</HStack>
        }
      />
    );
  if (filteredResumes.length === 0)
    return (
      <EmptyState
        title="No matching resumes"
        description="Try a different search term or clear your search."
      />
    );
  return (
    <LinkProvider component={ResumeCardLink}>
      <Grid columns={{ minWidth: 320 }} gap={2} className="-m-2">
        {filteredResumes.map((resume) => (
          <ResumeCard
            key={resume.id}
            resume={resume}
            busy={actionInProgress === resume.id}
            onEdit={() => onEdit(resume.id)}
            onSetDefault={() => onSetDefault(resume.id)}
            onDelete={() => onDelete(resume)}
          />
        ))}
      </Grid>
    </LinkProvider>
  );
}

export function BaseResumesPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<BaseResumeSummary | null>(
    null,
  );
  const { toast } = useToast();
  const deferredSearch = useDeferredValue(search);
  const { data: resumes, error: queryError } = useBaseResumesQuery();
  const displayedError =
    error ?? (queryError instanceof Error ? queryError.message : null);

  async function handleSetDefault(resumeId: string) {
    setActionInProgress(resumeId);
    setError(null);
    try {
      await setDefaultBaseResume(resumeId);
      toast("Default resume updated");
      await invalidateBaseResumeQueries(queryClient);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to set default resume.",
      );
      toast("Failed to set default", "error");
    } finally {
      setActionInProgress(null);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setActionInProgress(deleteTarget.id);
    setError(null);
    try {
      await deleteBaseResume(deleteTarget.id);
      toast(`"${deleteTarget.name}" deleted`);
      await invalidateBaseResumeQueries(queryClient);
      setDeleteTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete resume.");
      toast("Failed to delete resume", "error");
    } finally {
      setActionInProgress(null);
    }
  }

  const filteredResumes = (resumes ?? []).filter((resume) =>
    resume.name.toLowerCase().includes(deferredSearch.trim().toLowerCase()),
  );

  return (
    <VStack gap={5} className="page-enter">
      <PageHeader
        title="Resumes"
        subtitle="Manage your base resume templates"
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => navigate("/app/resumes/new?mode=upload")}
            >
              Upload PDF
            </Button>
            <Button onClick={() => navigate("/app/resumes/new?mode=blank")}>
              Start from Scratch
            </Button>
          </>
        }
      />

      <ErrorBanner
        error={displayedError}
        className="mb-4"
        onClear={error ? () => setError(null) : undefined}
      />

      <VStack gap={4} width="100%">
        <TextInput
          label="Search resumes"
          isLabelHidden
          placeholder="Search resumes…"
          startIcon={Search}
          value={search}
          onChange={setSearch}
          hasClear
          className="w-full"
        />
        <BaseResumeContent
          resumes={resumes}
          filteredResumes={filteredResumes}
          actionInProgress={actionInProgress}
          onCreate={(mode) => navigate(`/app/resumes/new?mode=${mode}`)}
          onEdit={(id) => navigate(`/app/resumes/${id}`)}
          onSetDefault={(id) => void handleSetDefault(id)}
          onDelete={setDeleteTarget}
        />
      </VStack>
      <ConfirmModal
        open={deleteTarget !== null}
        title="Delete resume?"
        message={`This will permanently remove "${deleteTarget?.name ?? "this resume"}". This action cannot be undone.`}
        confirmLabel="Delete Resume"
        variant="danger"
        loading={deleteTarget !== null && actionInProgress === deleteTarget.id}
        onConfirm={() => {
          void handleDelete();
        }}
        onCancel={() => {
          if (deleteTarget === null || actionInProgress !== deleteTarget.id) {
            setDeleteTarget(null);
          }
        }}
      />
    </VStack>
  );
}
