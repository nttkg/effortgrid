import { useState, useMemo, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Tabs,
  Text,
  Alert,
  Stack,
  NavLink,
  Badge,
  Group,
  ScrollArea,
  Title,
  Button,
  NumberInput,
  Textarea,
  Slider,
  Table,
  Center,
  Loader,
} from '@mantine/core';
import { DatePicker } from '@mantine/dates';
import { useForm } from '@mantine/form';
import { IconAlertCircle, IconDeviceFloppy, IconHistory, IconPlus } from '@tabler/icons-react';
import { WbsElementDetail, WbsElementType, ActualCost, ProgressUpdate } from '../../types';
import classes from './ExecutionView.module.css';
import dayjs from 'dayjs';

// Reusable types
interface TreeNode extends WbsElementDetail {
  children: TreeNode[];
}

interface ExecutionViewProps {
  planVersionId: number | null;
  isReadOnly: boolean;
}

// --- WBS Tree Component (re-used logic) ---

const WbsTree = ({
  nodes,
  onSelectActivity,
  selectedId,
}: {
  nodes: TreeNode[];
  onSelectActivity: (element: WbsElementDetail) => void;
  selectedId: number | null;
}) => {
  const getBadgeColor = (type: WbsElementType) => ({ Project: 'blue', WorkPackage: 'cyan', Activity: 'teal' }[type] || 'gray');

  const renderNode = (node: TreeNode, level: number) => (
    <Stack key={node.id} gap={0}>
      <NavLink
        label={node.title}
        leftSection={<Badge color={getBadgeColor(node.elementType)} size="sm">{node.elementType.substring(0, 1)}</Badge>}
        style={{ paddingLeft: level * 20 + 12 }}
        onClick={() => { if (node.elementType === 'Activity') onSelectActivity(node) }}
        disabled={node.elementType !== 'Activity'}
        active={node.id === selectedId}
      />
      {node.children.map(child => renderNode(child, level + 1))}
    </Stack>
  );

  return <>{nodes.map(node => renderNode(node, 0))}</>;
};


// --- Time Tracking Tab ---

const TimeTrackingTab = ({ activity }: { activity: WbsElementDetail }) => {
  const [history, setHistory] = useState<ActualCost[]>([]);

  const fetchHistory = useCallback(async () => {
    try {
      const result = await invoke<ActualCost[]>('get_actual_costs_for_element', { wbsElementId: activity.wbsElementId });
      setHistory(result);
    } catch (e) {
      console.error("Failed to fetch actual costs:", e);
    }
  }, [activity]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const form = useForm({
    initialValues: { workDate: new Date(), actualCost: 0 },
    validate: {
      actualCost: (val) => val <= 0 ? 'Cost must be positive' : null,
    }
  });

  const handleSubmit = async (values: typeof form.values) => {
    try {
      await invoke('add_actual_cost', {
        payload: {
          wbsElementId: activity.wbsElementId,
          workDate: dayjs(values.workDate).format('YYYY-MM-DD'),
          actualCost: values.actualCost
        }
      });
      form.reset();
      fetchHistory();
    } catch (e) {
      console.error("Failed to add actual cost:", e);
    }
  };

  const rows = history.map(item => (
    <Table.Tr key={item.id}>
      <Table.Td>{item.workDate}</Table.Td>
      <Table.Td>{item.actualCost}</Table.Td>
    </Table.Tr>
  ));

  return (
    <div className={classes.wrapper}>
      <div className={classes.form_section}>
        <form onSubmit={form.onSubmit(handleSubmit)}>
          <Stack>
            <Title order={4}>Log Time for: {activity.title}</Title>
            <DatePicker {...form.getInputProps('workDate')} />
            <NumberInput label="Actual Cost (e.g., hours)" min={0.1} step={0.1} {...form.getInputProps('actualCost')} />
            <Button type="submit" leftSection={<IconPlus size={16}/>}>Add Entry</Button>
          </Stack>
        </form>
      </div>
      <Stack style={{ flex: 1 }}>
        <Title order={4}><IconHistory size={18} /> History</Title>
        <ScrollArea style={{ flex: 1 }}>
          <Table>
            <Table.Thead>
              <Table.Tr><Table.Th>Date</Table.Th><Table.Th>Cost</Table.Th></Table.Tr>
            </Table.Thead>
            <Table.Tbody>{rows}</Table.Tbody>
          </Table>
        </ScrollArea>
      </Stack>
    </div>
  );
};


// --- Progress Update Tab ---

const ProgressUpdateTab = ({ activity }: { activity: WbsElementDetail }) => {
  const [history, setHistory] = useState<ProgressUpdate[]>([]);

  const fetchHistory = useCallback(async () => {
    try {
      const result = await invoke<ProgressUpdate[]>('get_progress_updates_for_element', { wbsElementId: activity.wbsElementId });
      setHistory(result);
    } catch (e) {
      console.error("Failed to fetch progress updates:", e);
    }
  }, [activity]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);
  
  const lastProgress = history[0]?.progressPercent ?? 0;
  
  const form = useForm({
    initialValues: { reportDate: new Date(), progressPercent: lastProgress, notes: '' },
  });

  // Keep form in sync with history
  useEffect(() => {
      form.setFieldValue('progressPercent', lastProgress);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastProgress]);
  
  const handleSubmit = async (values: typeof form.values) => {
    try {
      await invoke('add_progress_update', {
        payload: {
          wbsElementId: activity.wbsElementId,
          reportDate: dayjs(values.reportDate).format('YYYY-MM-DD'),
          progressPercent: values.progressPercent,
          notes: values.notes || null,
        }
      });
      form.setFieldValue('notes', ''); // Keep date and progress for next update
      fetchHistory();
    } catch (e) {
      console.error("Failed to add progress update:", e);
    }
  };

  const rows = history.map(item => (
    <Table.Tr key={item.id}>
      <Table.Td>{item.reportDate}</Table.Td>
      <Table.Td>{item.progressPercent}%</Table.Td>
      <Table.Td><Text truncate maw={200}>{item.notes}</Text></Table.Td>
    </Table.Tr>
  ));

  return (
    <div className={classes.wrapper}>
      <div className={classes.form_section}>
        <form onSubmit={form.onSubmit(handleSubmit)}>
          <Stack>
            <Title order={4}>Update Progress for: {activity.title}</Title>
            <DatePicker {...form.getInputProps('reportDate')} />
            <Textarea label="Notes" placeholder='Optional notes...' {...form.getInputProps('notes')} />
            <Stack gap={4}>
                <Text size="sm" fw={500}>Progress: {form.values.progressPercent}%</Text>
                <Slider min={0} max={100} step={1} {...form.getInputProps('progressPercent')} />
            </Stack>
            <Button type="submit" leftSection={<IconDeviceFloppy size={16}/>}>Save Update</Button>
          </Stack>
        </form>
      </div>
       <Stack style={{ flex: 1 }}>
        <Title order={4}><IconHistory size={18} /> History</Title>
        <ScrollArea style={{ flex: 1 }}>
          <Table>
            <Table.Thead>
              <Table.Tr><Table.Th>Date</Table.Th><Table.Th>Progress</Table.Th><Table.Th>Notes</Table.Th></Table.Tr>
            </Table.Thead>
            <Table.Tbody>{rows}</Table.Tbody>
          </Table>
        </ScrollArea>
      </Stack>
    </div>
  );
};


// --- Main ExecutionView Component ---

export function ExecutionView({ planVersionId, isReadOnly }: ExecutionViewProps) {
  const [wbsElements, setWbsElements] = useState<WbsElementDetail[]>([]);
  const [selectedActivity, setSelectedActivity] = useState<WbsElementDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchWbsElements = useCallback(async () => {
    if (!planVersionId) {
      setIsLoading(false);
      setWbsElements([]);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
        const result = await invoke<WbsElementDetail[]>('list_wbs_elements', { planVersionId });
        setWbsElements(result);
    } catch (e: any) {
        console.error("Failed to fetch WBS elements:", e);
        setError('Failed to load WBS data. Check console for details.');
        setWbsElements([]);
    } finally {
        setIsLoading(false);
    }
  }, [planVersionId]);

  useEffect(() => {
    fetchWbsElements();
    setSelectedActivity(null);
  }, [planVersionId, fetchWbsElements]);

  const tree = useMemo(() => {
    const items = [...wbsElements];
    const map: { [key: number]: TreeNode } = {};
    const roots: TreeNode[] = [];
    items.forEach((item) => {
      map[item.wbsElementId] = { ...item, children: [] };
    });
    items.forEach((item) => {
      const node = map[item.wbsElementId];
      if (item.parentElementId && map[item.parentElementId]) {
        map[item.parentElementId].children.push(node);
      } else {
        roots.push(node);
      }
    });
    return roots;
  }, [wbsElements]);
  
  if (isReadOnly) {
    return (
      <Alert color="orange" title="Read-only Mode" icon={<IconAlertCircle />}>
        You are viewing a historical baseline. To record actuals or progress, please select the "Working Draft" from the header.
      </Alert>
    );
  }

  if (!planVersionId) {
    return <Text c="dimmed" ta="center" pt="xl">Please select a project to start tracking execution.</Text>;
  }

  if (isLoading) {
    return <Center style={{ height: '100%' }}><Loader /></Center>;
  }

  if (error) {
    return <Alert color="red" title="Error" icon={<IconAlertCircle />}>{error}</Alert>;
  }

  return (
    <div className={classes.wrapper}>
      <div className={classes.tree_container}>
        <Text size="sm" fw={700} c="dimmed" mb="xs">SELECT AN ACTIVITY</Text>
        <ScrollArea h="100%">
            <WbsTree nodes={tree} onSelectActivity={setSelectedActivity} selectedId={selectedActivity?.id || null} />
        </ScrollArea>
      </div>

      <div className={classes.details_container}>
        {!selectedActivity ? (
            <Center style={{flex: 1}}><Text c="dimmed">Select an activity from the left to track time or progress.</Text></Center>
        ) : (
            <Tabs defaultValue="time">
                <Tabs.List>
                    <Tabs.Tab value="time">Time Tracking (AC)</Tabs.Tab>
                    <Tabs.Tab value="progress">Progress Update (EV)</Tabs.Tab>
                </Tabs.List>

                <Tabs.Panel value="time" pt="md"><TimeTrackingTab activity={selectedActivity} /></Tabs.Panel>
                <Tabs.Panel value="progress" pt="md"><ProgressUpdateTab activity={selectedActivity} /></Tabs.Panel>
            </Tabs>
        )}
      </div>
    </div>
  );
}
