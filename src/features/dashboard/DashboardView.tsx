import { useEffect, useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  SimpleGrid,
  Text,
  Center,
  Loader,
  Alert,
  Title,
  Stack,
  Button,
  Group
} from '@mantine/core';
import { IconAlertCircle, IconPlus } from '@tabler/icons-react';
import { WbsElementDetail, WidgetConfig } from '../../types';
import { DashboardWidget } from './DashboardWidget';

const DEFAULT_WIDGETS: Omit<WidgetConfig, 'id'>[] = [
    { title: 'Overall S-Curve', chartType: 'SCurve', granularity: 'monthly', targetWbsId: null },
    { title: 'Overall Forecast', chartType: 'EvEtcArea', granularity: 'monthly', targetWbsId: null },
];

interface DashboardViewProps {
  planVersionId: number | null;
}

export function DashboardView({ planVersionId }: DashboardViewProps) {
  const [widgets, setWidgets] = useState<WidgetConfig[]>([]);
  const [filterableNodes, setFilterableNodes] = useState<{label: string, value: string}[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch filterable nodes once when planVersionId changes
  useEffect(() => {
    if (planVersionId) {
        setLoading(true);
        invoke<WbsElementDetail[]>('get_filterable_wbs_nodes', { planVersionId })
            .then(nodes => {
                const formatted = nodes.map(n => ({ label: n.title, value: String(n.wbsElementId) }));
                setFilterableNodes(formatted);
                // Reset to default widgets when project/plan changes
                setWidgets(DEFAULT_WIDGETS.map(w => ({...w, id: crypto.randomUUID()})));
            })
            .catch(e => {
                console.error("Failed to fetch filterable nodes:", e);
                setError("Could not load dashboard filters.");
            })
            .finally(() => setLoading(false));
    } else {
        setWidgets([]);
        setFilterableNodes([]);
        setLoading(false);
    }
  }, [planVersionId]);

  const addWidget = () => {
    const newWidget: WidgetConfig = {
      id: crypto.randomUUID(),
      title: 'New S-Curve',
      chartType: 'SCurve',
      granularity: 'monthly',
      targetWbsId: null,
    };
    setWidgets(current => [...current, newWidget]);
  };

  const updateWidget = useCallback((id: string, newConfig: Partial<WidgetConfig>) => {
    setWidgets(current =>
      current.map(w => (w.id === id ? { ...w, ...newConfig } : w))
    );
  }, []);

  const removeWidget = useCallback((id: string) => {
    setWidgets(current => current.filter(w => w.id !== id));
  }, []);

  if (loading) {
    return <Center style={{ height: '100%' }}><Loader /></Center>;
  }
  if (error) {
    return <Alert color="red" title="Error" icon={<IconAlertCircle />}>{error}</Alert>;
  }
  if (!planVersionId) {
    return <Text c="dimmed" ta="center" pt="xl">Please select a project to view the dashboard.</Text>;
  }

  return (
    <Stack>
        <Group justify="space-between">
            <Title order={2}>EVM Dashboard</Title>
            <Button onClick={addWidget} leftSection={<IconPlus size={16}/>}>Add Panel</Button>
        </Group>
      
        <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg">
            {widgets.map(config => (
                <DashboardWidget
                    key={config.id}
                    config={config}
                    planVersionId={planVersionId}
                    onUpdate={updateWidget}
                    onRemove={removeWidget}
                    filterableNodes={filterableNodes}
                />
            ))}
        </SimpleGrid>
    </Stack>
  );
}
