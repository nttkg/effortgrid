import { useEffect, useState, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
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
  Center,
  Loader,
  Container,
  Menu,
} from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { useDisclosure } from '@mantine/hooks';
import { useForm, zodResolver } from '@mantine/form';
import { z } from 'zod';
import { IconPlus, IconTree, IconLayoutDashboard, IconCalendarStats, IconDeviceFloppy, IconBriefcase, IconUsers, IconDatabase, IconFlag } from '@tabler/icons-react';
import { Portfolio, PlanVersion, AppSettings } from './types';
import { WbsListView } from './features/wbs/WbsListView';
import { ExecutionView } from './features/execution/ExecutionView';
import { DashboardView } from './features/dashboard/DashboardView';
import { MilestoneView } from './features/milestones/MilestoneView';
import { UserManagementView } from './features/users/UserManagementView';

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
  const [dbPath, setDbPath] = useState<string | null>(null);
  const [recentPaths, setRecentPaths] = useState<string[]>([]);
  const [isDbLoading, setIsDbLoading] = useState(true);

  const [createModalOpened, { open: openCreateModal, close: closeCreateModal }] = useDisclosure(false);
  const [baselineModalOpened, { open: openBaselineModal, close: closeBaselineModal }] = useDisclosure(false);

  const fetchPortfolios = async () => {
    try {
      const result = await invoke<Portfolio[]>('list_portfolios');
      setPortfolios(result);
      return result;
    } catch (error) {
      console.error('Failed to fetch portfolios:', error);
      return [];
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
    const initDb = async () => {
      try {
        const path = await invoke<string | null>('get_current_db_path');
        setDbPath(path);
        const settings = await invoke<AppSettings>('get_settings');
        setRecentPaths(settings.recentDbPaths || []);
        if (path) {
          const ports = await fetchPortfolios();
          const savedPortfolioId = settings.projectSettings?.[path]?.selectedPortfolioId;
          
          if (savedPortfolioId && ports.find(p => String(p.id) === savedPortfolioId)) {
            setSelectedPortfolioId(savedPortfolioId);
          } else if (ports.length > 0) {
            setSelectedPortfolioId(String(ports[0].id));
          }
        }
      } catch (error) {
        console.error('Failed to init DB state:', error);
      } finally {
        setIsDbLoading(false);
      }
    };
    initDb();
  }, []);

  const handlePortfolioChange = async (id: string | null) => {
    setSelectedPortfolioId(id);
    if (dbPath && id) {
      try {
        const settings = await invoke<AppSettings>('get_settings');
        if (!settings.projectSettings) settings.projectSettings = {};
        if (!settings.projectSettings[dbPath]) settings.projectSettings[dbPath] = {};
        settings.projectSettings[dbPath].selectedPortfolioId = id;
        await invoke('update_settings', { settings });
      } catch (e) {
        console.error("Failed to save selected portfolio:", e);
      }
    }
  };

  const handleOpenDb = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'SQLite Database', extensions: ['db', 'sqlite'] }]
    });
    if (selected && typeof selected === 'string') {
      await openDatabasePath(selected);
    }
  };

  const handleCreateDb = async () => {
    const selected = await save({
      filters: [{ name: 'SQLite Database', extensions: ['db'] }]
    });
    if (selected && typeof selected === 'string') {
      await openDatabasePath(selected);
    }
  };

  const openDatabasePath = async (path: string) => {
    try {
      await invoke('open_database_file', { path });
      setDbPath(path);
      const settings = await invoke<AppSettings>('get_settings');
      setRecentPaths(settings.recentDbPaths || []);
      const ports = await fetchPortfolios();
      
      const savedPortfolioId = settings.projectSettings?.[path]?.selectedPortfolioId;
      if (savedPortfolioId && ports.find(p => String(p.id) === savedPortfolioId)) {
        setSelectedPortfolioId(savedPortfolioId);
      } else if (ports.length > 0) {
        setSelectedPortfolioId(String(ports[0].id));
      } else {
        setSelectedPortfolioId(null);
      }
    } catch (e: any) {
      console.error("Failed to open db", e);
    }
  };

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

  if (isDbLoading) {
    return <Center h="100vh"><Loader /></Center>;
  }

  if (!dbPath) {
    return (
      <Container size="sm" mt={100}>
        <Stack align="center" gap="xl">
          <Title>Welcome to EffortGrid</Title>
          <Text c="dimmed">A local-first WBS and EVM management tool.</Text>
          <Group>
            <Button size="lg" onClick={handleCreateDb}>Create New Database</Button>
            <Button size="lg" variant="light" onClick={handleOpenDb}>Open Existing Database</Button>
          </Group>
          {recentPaths.length > 0 && (
            <Stack mt="xl" w="100%">
              <Text fw={500}>Recent Databases</Text>
              {recentPaths.map(p => (
                <Button key={p} variant="subtle" justify="flex-start" onClick={() => openDatabasePath(p)}>
                  {p}
                </Button>
              ))}
            </Stack>
          )}
        </Stack>
      </Container>
    );
  }

  return (
    <>
      <Notifications />
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
                onChange={handlePortfolioChange}
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
            label="Tracking Matrix"
            leftSection={<IconCalendarStats size="1rem" />}
            active={activeView === 'execution'}
            onClick={() => setActiveView('execution')}
          />
          <NavLink
            href="#"
            label="User Management"
            leftSection={<IconUsers size="1rem" />}
            active={activeView === 'users'}
            onClick={() => setActiveView('users')}
          />
          <NavLink
            href="#"
            label="Milestones"
            leftSection={<IconFlag size="1rem" />}
            active={activeView === 'milestones'}
            onClick={() => setActiveView('milestones')}
          />
          {/* ... other nav links from UI_DESIGN.md */}
          <Button onClick={openCreateModal} fullWidth leftSection={<IconPlus size={14} />} mt="xl">
            New Portfolio
          </Button>

          <div style={{ marginTop: 'auto', borderTop: '1px solid var(--mantine-color-default-border)', paddingTop: 'var(--mantine-spacing-md)' }}>
            <Menu shadow="md" width={300} position="right-end">
              <Menu.Target>
                <Button variant="subtle" color="gray" fullWidth justify="flex-start" leftSection={<IconDatabase size={16} />}>
                  <Text size="sm" truncate>{dbPath.split(/[\\/]/).pop()}</Text>
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>Database Options</Menu.Label>
                <Menu.Item onClick={handleOpenDb} leftSection={<IconDatabase size={14} />}>Open Another Database...</Menu.Item>
                <Menu.Item onClick={handleCreateDb} leftSection={<IconPlus size={14} />}>Create New Database...</Menu.Item>
                {recentPaths.length > 0 && (
                  <>
                    <Menu.Divider />
                    <Menu.Label>Recent</Menu.Label>
                    {recentPaths.map(p => (
                      <Menu.Item key={p} onClick={() => openDatabasePath(p)}><Text size="xs" truncate>{p}</Text></Menu.Item>
                    ))}
                  </>
                )}
              </Menu.Dropdown>
            </Menu>
          </div>
        </AppShell.Navbar>

        <AppShell.Main>
          {activeView === 'dashboard' && <DashboardView planVersionId={selectedPlanVersionId ? Number(selectedPlanVersionId) : null} dbPath={dbPath} />}
          {activeView === 'wbs' && <WbsListView planVersionId={selectedPlanVersionId ? Number(selectedPlanVersionId) : null} isReadOnly={isReadOnly} />}
          {activeView === 'execution' && <ExecutionView planVersionId={selectedPlanVersionId ? Number(selectedPlanVersionId) : null} isReadOnly={isReadOnly} />}
          {activeView === 'milestones' && <MilestoneView planVersionId={selectedPlanVersionId ? Number(selectedPlanVersionId) : null} isReadOnly={isReadOnly} portfolioId={selectedPortfolioId ? Number(selectedPortfolioId) : null} />}
          {activeView === 'users' && <UserManagementView />}
        </AppShell.Main>
      </AppShell>
    </>
  );
}

export default App;
