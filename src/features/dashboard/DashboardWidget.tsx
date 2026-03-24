import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Paper,
  Text,
  Group,
  Center,
  Loader,
  Alert,
  Title,
  Stack,
  Badge,
  SegmentedControl,
  ActionIcon,
  Tooltip as MantineTooltip,
  Select,
} from '@mantine/core';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Brush,
  ComposedChart,
  Area,
} from 'recharts';
import { IconAlertCircle, IconTrash } from '@tabler/icons-react';
import { EvmKpis, SCurveDataPoint, WidgetConfig, WbsElementDetail, ChartType, Granularity } from '../../types';
import dayjs from 'dayjs';
import classes from './Dashboard.module.css';

interface WidgetProps {
  config: WidgetConfig;
  planVersionId: number;
  onUpdate: (id: string, newConfig: Partial<WidgetConfig>) => void;
  onRemove: (id: string) => void;
  filterableNodes: {label: string, value: string}[];
}

const KpiCards = ({ kpis }: { kpis: EvmKpis }) => {
    const kpiCardsData = [
        { title: 'CPI', value: kpis.cpi.toFixed(2), color: kpis.cpi >= 1 ? 'teal' : 'red' },
        { title: 'SPI', value: kpis.spi.toFixed(2), color: kpis.spi >= 1 ? 'teal' : 'red' },
        { title: 'CV', value: (kpis.ev - kpis.ac).toLocaleString(), color: (kpis.ev - kpis.ac) >= 0 ? 'teal' : 'red' },
        { title: 'SV', value: (kpis.ev - kpis.pv).toLocaleString(), color: (kpis.ev - kpis.pv) >= 0 ? 'teal' : 'red' },
    ];
    return (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
            {kpiCardsData.map(stat => (
                <Paper withBorder p="sm" radius="md" key={stat.title}>
                    <Group justify='space-between'>
                        <Text size="xs" c="dimmed" fw={700} tt="uppercase">{stat.title}</Text>
                        <Badge color={stat.color} variant='light' size='xs' />
                    </Group>
                    <Text fw={700} size="lg">{stat.value}</Text>
                </Paper>
            ))}
        </SimpleGrid>
    )
}

export function DashboardWidget({ config, planVersionId, onUpdate, onRemove, filterableNodes }: WidgetProps) {
  const [kpis, setKpis] = useState<EvmKpis | null>(null);
  const [sCurveData, setSCurveData] = useState<SCurveDataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const today = dayjs().format('YYYY-MM-DD');
    Promise.all([
      invoke<EvmKpis>('get_evm_kpis', { payload: { planVersionId, date: today, targetWbsId: config.targetWbsId } }),
      invoke<SCurveDataPoint[]>('get_s_curve_data', { payload: { planVersionId, granularity: config.granularity, targetWbsId: config.targetWbsId } }),
    ])
      .then(([kpisData, sCurveData]) => {
        setKpis(kpisData);
        setSCurveData(sCurveData);
      })
      .catch((e) => {
        console.error(`Failed to fetch widget data for ${config.title}:`, e);
        setError('Could not load chart data.');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [planVersionId, config]);

  const chart = (
    loading ? <Center h={200}><Loader/></Center> :
    error ? <Alert color="red" title="Error" icon={<IconAlertCircle />}>{error}</Alert> :
    config.chartType === 'SCurve' ? (
        <LineChart data={sCurveData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }} syncId="sCurveSync">
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="cumulativePv" name="PV" stroke="#8884d8" dot={false} />
            <Line type="monotone" dataKey="cumulativeAc" name="AC" stroke="#ca4f4f" dot={false} />
            <Line type="monotone" dataKey="cumulativeEv" name="EV" stroke="#82ca9d" dot={false} />
            <Brush dataKey="date" height={30} stroke="#8884d8" />
        </LineChart>
    ) : (
        <ComposedChart data={sCurveData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }} syncId="sCurveSync">
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Area type="monotone" dataKey="actualEtc" stackId="a" stroke="#4c6a85" fill="#4c6a85" name="ETC (Actual)" />
            <Area type="monotone" dataKey="cumulativeEv" stackId="a" stroke="#82ca9d" fill="#82ca9d" name="EV" />
            <Line type="monotone" dataKey="plannedEtc" stroke="#ff7300" strokeWidth={2} name="ETC (Planned)" dot={false}/>
        </ComposedChart>
    )
  );

  return (
    <Paper withBorder p="md" radius="md">
        <Stack>
            <Group justify="space-between" className={classes.widget_header}>
                <Title order={4}>{config.title}</Title>
                <ActionIcon variant="subtle" color="red" onClick={() => onRemove(config.id)}><IconTrash size={16} /></ActionIcon>
            </Group>
            <Group>
                <SegmentedControl
                    value={config.granularity}
                    onChange={(value) => onUpdate(config.id, { granularity: value as Granularity })}
                    data={[
                        { label: 'Daily', value: 'daily' },
                        { label: 'Weekly', value: 'weekly' },
                        { label: 'Monthly', value: 'monthly' },
                    ]}
                />
                 <Select
                    placeholder="Filter by WBS..."
                    data={[{label: 'All Project', value: ''}, ...filterableNodes]}
                    value={String(config.targetWbsId || '')}
                    onChange={(value) => onUpdate(config.id, { targetWbsId: value ? Number(value) : null })}
                    clearable
                />
            </Group>
            {kpis && <KpiCards kpis={kpis} />}
            <ResponsiveContainer width="100%" height={300}>
                {chart}
            </ResponsiveContainer>
        </Stack>
    </Paper>
  )
}
