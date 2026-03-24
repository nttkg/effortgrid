import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  AppShell,
  Burger,
  Group,
  Select,
  Button,
  Modal,
  TextInput,
  Stack,
  NavLink,
  Title,
  Text,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { useForm, zodResolver } from '@mantine/form';
import { z } from 'zod';
import { IconPlus, IconTree, IconLayoutDashboard } from '@tabler/icons-react';
import { Project, PlanVersion } from './types';
import { WbsListView } from './features/wbs/WbsListView';

const createProjectSchema = z.object({
  name: z.string().min(1, { message: 'Project name is required' }),
});

function App() {
  const [mobileOpened, { toggle: toggleMobile }] = useDisclosure();
  const [desktopOpened, { toggle: toggleDesktop }] = useDisclosure(true);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [planVersions, setPlanVersions] = useState<PlanVersion[]>([]);
  const [selectedPlanVersionId, setSelectedPlanVersionId] = useState<string | null>(null);

  const [createModalOpened, { open: openCreateModal, close: closeCreateModal }] = useDisclosure(false);

  const fetchProjects = async () => {
    try {
      const result = await invoke<Project[]>('list_projects');
      setProjects(result);
    } catch (error) {
      console.error('Failed to fetch projects:', error);
    }
  };

  const fetchPlanVersions = async (projectId: number) => {
    try {
      const result = await invoke<PlanVersion[]>('list_plan_versions_for_project', {
        projectId,
      });
      setPlanVersions(result);
      // Select the draft version by default
      const draft = result.find((v) => v.isDraft);
      if (draft) {
        setSelectedPlanVersionId(String(draft.id));
      } else if (result.length > 0) {
        setSelectedPlanVersionId(String(result[0].id));
      } else {
        setSelectedPlanVersionId(null);
      }
    } catch (error) {
      console.error('Failed to fetch plan versions:', error);
      setPlanVersions([]);
      setSelectedPlanVersionId(null);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  useEffect(() => {
    if (selectedProjectId) {
      fetchPlanVersions(Number(selectedProjectId));
    } else {
      setPlanVersions([]);
      setSelectedPlanVersionId(null);
    }
  }, [selectedProjectId]);

  const form = useForm({
    initialValues: { name: '' },
    validate: zodResolver(createProjectSchema),
  });

  const handleCreateProject = async (values: { name: string }) => {
    try {
      await invoke('create_project', { name: values.name });
      closeCreateModal();
      form.reset();
      await fetchProjects(); // Refresh project list
    } catch (error) {
      console.error('Failed to create project:', error);
    }
  };

  const projectSelectData = projects.map((p) => ({ value: String(p.id), label: p.name }));
  const planVersionSelectData = planVersions.map((v) => ({
    value: String(v.id),
    label: `${v.isDraft ? '🟢' : '🔒'} ${v.name}`,
  }));

  const selectedProject = projects.find(p => p.id === Number(selectedProjectId));

  return (
    <>
      <Modal opened={createModalOpened} onClose={closeCreateModal} title="Create New Project">
        <form onSubmit={form.onSubmit(handleCreateProject)}>
          <Stack>
            <TextInput
              withAsterisk
              label="Project Name"
              placeholder="e.g., My Awesome Project"
              {...form.getInputProps('name')}
            />
            <Group justify="flex-end" mt="md">
              <Button type="submit">Create Project</Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      <AppShell
        header={{ height: 60 }}
        navbar={{ width: 250, breakpoint: 'sm', collapsed: { mobile: !mobileOpened, desktop: !desktopOpened } }}
        padding="md"
      >
        <AppShell.Header>
          <Group h="100%" px="md">
            <Burger opened={mobileOpened} onClick={toggleMobile} hiddenFrom="sm" size="sm" />
            <Burger opened={desktopOpened} onClick={toggleDesktop} visibleFrom="sm" size="sm" />
            <Title order={3}>EffortGrid</Title>
            <Group style={{ flex: 1 }} justify="center">
              <Select
                placeholder="Select a project"
                data={projectSelectData}
                value={selectedProjectId}
                onChange={setSelectedProjectId}
                clearable
                style={{ width: 200 }}
              />
              <Select
                placeholder="Select a version"
                data={planVersionSelectData}
                value={selectedPlanVersionId}
                onChange={setSelectedPlanVersionId}
                disabled={!selectedProjectId}
                style={{ width: 200 }}
              />
            </Group>
          </Group>
        </AppShell.Header>

        <AppShell.Navbar p="md">
          <Text size="xs" tt="uppercase" c="dimmed" fw={700} mb="sm">
            {selectedProject ? selectedProject.name : 'No Project Selected'}
          </Text>
          <NavLink href="#" label="Dashboard" leftSection={<IconLayoutDashboard size="1rem" />} disabled />
          <NavLink href="#" label="WBS & Estimates" leftSection={<IconTree size="1rem" />} active />
          {/* ... other nav links from UI_DESIGN.md */}
          <Button onClick={openCreateModal} fullWidth leftSection={<IconPlus size={14} />} mt="xl">
            New Project
          </Button>
        </AppShell.Navbar>

        <AppShell.Main>
          <WbsListView planVersionId={selectedPlanVersionId ? Number(selectedPlanVersionId) : null} />
        </AppShell.Main>
      </AppShell>
    </>
  );
}

export default App;
