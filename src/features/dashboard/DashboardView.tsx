import { useEffect, useState, useCallback } from 'react';
import {
  SimpleGrid,
  Text,
  Center,
  Loader,
  Title,
  Stack,
  Button,
  Group
} from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';
import { WidgetConfig } from '../../types';
import { DashboardWidget } from './DashboardWidget';

const DEFAULT_WIDGETS: Omit<WidgetConfig, 'id'>[] = [
    { title: 'Overall S-Curve', chartType: 'SCurve', granularity: 'monthly', wbsIds: [], userIds: [], milestoneIds: [], tags: [] },
    { title: 'Overall Forecast', chartType: 'EvEtcArea', granularity: 'monthly', wbsIds: [], userIds: [], milestoneIds: [], tags: [] },
];

interface DashboardViewProps {
  planVersionId: number | null;
}

export function DashboardView({ planVersionId }: DashboardViewProps) {
  const [widgets, setWidgets] = useState<WidgetConfig[]>([]);
  const [loading, setLoading] = useState(true);

  // Reset widgets when planVersionId changes
  useEffect(() => {
    if (planVersionId) {
        // Reset to default widgets when project/plan changes
        setWidgets(DEFAULT_WIDGETS.map(w => ({...w, id: crypto.randomUUID()})));
    } else {
        setWidgets([]);
    }
    setLoading(false);
  }, [planVersionId]);

  const addWidget = () => {
    const newWidget: WidgetConfig = {
      id: crypto.randomUUID(),
      title: 'New S-Curve',
      chartType: 'SCurve',
      granularity: 'monthly',
      wbsIds: [],
      userIds: [],
      milestoneIds: [],
      tags: [],
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
                />
            ))}
        </SimpleGrid>
    </Stack>
  );
}
