import { useEffect, useState, useMemo } from 'react';
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
import { IconPlus, IconTree, IconLayoutDashboard, IconCalendarStats, IconDeviceFloppy, IconBriefcase } from '@tabler/icons-react';
import { Portfolio, PlanVersion } from './types';
import { WbsListView } from './features/wbs/WbsListView';
import { AllocationGrid } from './features/allocations/AllocationGrid';
import { ExecutionView } from './features/execution/ExecutionView';
import { DashboardView } from './features/dashboard/DashboardView';

const createPortfolioSchema = z.object({
  name: z.string().min(1, { message: 'Portfolio name is required' }),
});

const createBaselineSchema = z.object({
  name: z.string().min(1, { message: 'Baseline name is required' }),
});

function App() {
  const [activeView, setActiveView] = useState('dashboard');
  const [mobileOpened, { toggle: toggleMobile }] = useDisclosure();
  const [desktopOpened, { toggle: toggleDesktop }] = useDisclosure(true);
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<string | null>(null);
  const [planVersions, setPlanVersions] = useState<PlanVersion[]>([]);
  const [selectedPlanVersionId, setSelectedPlanVersionId] = useState<string | null>(null);

  const [createModalOpened, { open: openCreateModal, close: closeCreateModal }] = useDisclosure(false);
  const [baselineModalOpened, { open: openBaselineModal, close: closeBaselineModal }] = useDisclosure(false);

  const fetchPortfolios = async () => {
    try {
      const result = await invoke<Portfolio[]>('list_portfolios');
      setPortfolios(result);
    } catch (error) {
      console.error('Failed to fetch portfolios:', error);
    }
  };

  const fetchPlanVersions = async (portfolioId: number) => {
    try {
      const result = await invoke<PlanVersion[]>('list_plan_versions_for_portfolio', {
        portfolioId,
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
    fetchPortfolios();
  }, []);

  useEffect(() => {
    if (selectedPortfolioId) {
      fetchPlanVersions(Number(selectedPortfolioId));
    } else {
      setPlanVersions([]);
      setSelectedPlanVersionId(null);
    }
  }, [selectedPortfolioId]);

  const selectedPlanVersion = useMemo(
    () => planVersions.find((v) => String(v.id) === selectedPlanVersionId),
    [planVersions, selectedPlanVersionId]
  );
  const isReadOnly = useMemo(() => (selectedPlanVersion ? !selectedPlanVersion.isDraft : true), [selectedPlanVersion]);

  const portfolioForm = useForm({
    initialValues: { name: '' },
    validate: zodResolver(createPortfolioSchema as any),
  });

  const baselineForm = useForm({
    initialValues: { name: '' },
    validate: zodResolver(createBaselineSchema as any),
  });

  const handleCreatePortfolio = async (values: { name: string }) => {
    try {
      await invoke('create_portfolio', { name: values.name });
      closeCreateModal();
      portfolioForm.reset();
      await fetchPortfolios(); // Refresh portfolio list
    } catch (error) {
      console.error('Failed to create portfolio:', error);
    }
  };

  const handleCreateBaseline = async (values: { name: string }) => {
    if (!selectedPortfolioId) return;
    try {
      await invoke('create_baseline', {
        payload: {
          portfolioId: Number(selectedPortfolioId),
          baselineName: values.name,
        },
      });
      closeBaselineModal();
      baselineForm.reset();
      await fetchPlanVersions(Number(selectedPortfolioId)); // Refresh plan versions
    } catch (error) {
      console.error('Failed to create baseline:', error);
    }
  };

  const portfolioSelectData = portfolios.map((p) => ({ value: String(p.id), label: p.name }));
  const planVersionSelectData = planVersions.map((v) => ({
    value: String(v.id),
    label: `${v.isDraft ? '🟢' : '🔒'} ${v.name}`,
  }));

  const selectedPortfolio = portfolios.find(p => p.id === Number(selectedPortfolioId));

  return (
    <>
      <Modal opened={createModalOpened} onClose={closeCreateModal} title="Create New Portfolio">
        <form onSubmit={portfolioForm.onSubmit(handleCreatePortfolio)}>
          <Stack>
            <TextInput
              withAsterisk
              label="Portfolio Name"
              placeholder="e.g., My Awesome Portfolio"
              {...portfolioForm.getInputProps('name')}
            />
            <Group justify="flex-end" mt="md">
              <Button type="submit">Create Portfolio</Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      <Modal opened={baselineModalOpened} onClose={closeBaselineModal} title="Save New Baseline">
        <form onSubmit={baselineForm.onSubmit(handleCreateBaseline)}>
          <Stack>
            <TextInput
              withAsterisk
              label="Baseline Name"
              placeholder='e.g., "V1.0 - Initial Plan"'
              {...baselineForm.getInputProps('name')}
            />
            <Group justify="flex-end" mt="md">
              <Button type="submit">Save Baseline</Button>
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
                placeholder="Select a portfolio"
                data={portfolioSelectData}
                value={selectedPortfolioId}
                onChange={setSelectedPortfolioId}
                clearable
                style={{ width: 200 }}
              />
              <Select
                placeholder="Select a version"
                data={planVersionSelectData}
                value={selectedPlanVersionId}
                onChange={setSelectedPlanVersionId}
                disabled={!selectedPortfolioId}
                style={{ width: 200 }}
              />
            </Group>
            {selectedPlanVersion?.isDraft && (
              <Button
                onClick={openBaselineModal}
                variant="light"
                leftSection={<IconDeviceFloppy size={16} />}
              >
                Save as Baseline
              </Button>
            )}
          </Group>
        </AppShell.Header>

        <AppShell.Navbar p="md">
          <Text size="xs" tt="uppercase" c="dimmed" fw={700} mb="sm">
            {selectedPortfolio ? selectedPortfolio.name : 'No Portfolio Selected'}
          </Text>
          <NavLink
            href="#"
            label="Dashboard"
            leftSection={<IconLayoutDashboard size="1rem" />}
            active={activeView === 'dashboard'}
            onClick={() => setActiveView('dashboard')}
          />
          <NavLink
            href="#"
            label="WBS & Estimates"
            leftSection={<IconTree size="1rem" />}
            active={activeView === 'wbs'}
            onClick={() => setActiveView('wbs')}
          />
          <NavLink
            href="#"
            label="Resource Allocation"
            leftSection={<IconCalendarStats size="1rem" />}
            active={activeView === 'allocations'}
            onClick={() => setActiveView('allocations')}
          />
          <NavLink
            href="#"
            label="Execution (Actuals/EV)"
            leftSection={<IconBriefcase size="1rem" />}
            active={activeView === 'execution'}
            onClick={() => setActiveView('execution')}
          />
          {/* ... other nav links from UI_DESIGN.md */}
          <Button onClick={openCreateModal} fullWidth leftSection={<IconPlus size={14} />} mt="xl">
            New Portfolio
          </Button>
        </AppShell.Navbar>

        <AppShell.Main>
          {activeView === 'dashboard' && <DashboardView planVersionId={selectedPlanVersionId ? Number(selectedPlanVersionId) : null} />}
          {activeView === 'wbs' && <WbsListView planVersionId={selectedPlanVersionId ? Number(selectedPlanVersionId) : null} isReadOnly={isReadOnly} />}
          {activeView === 'allocations' && <AllocationGrid planVersionId={selectedPlanVersionId ? Number(selectedPlanVersionId) : null} isReadOnly={isReadOnly} />}
          {activeView === 'execution' && <ExecutionView planVersionId={selectedPlanVersionId ? Number(selectedPlanVersionId) : null} isReadOnly={isReadOnly} />}
        </AppShell.Main>
      </AppShell>
    </>
  );
}

export default App;
