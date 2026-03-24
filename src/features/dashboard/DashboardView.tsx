import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  SimpleGrid,
  Paper,
  Text,
  Group,
  Center,
  Loader,
  Alert,
  Title,
  Stack,
  Badge,
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
} from 'recharts';
import { IconAlertCircle } from '@tabler/icons-react';
import { EvmKpis, SCurveDataPoint } from '../../types';
import classes from './Dashboard.module.css';
import dayjs from 'dayjs';

interface DashboardViewProps {
  planVersionId: number | null;
}


export function DashboardView({ planVersionId }: DashboardViewProps) {
  const [kpis, setKpis] = useState<EvmKpis | null>(null);
  const [sCurveData, setSCurveData] = useState<SCurveDataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (planVersionId) {
      setLoading(true);
      setError(null);
      const today = dayjs().format('YYYY-MM-DD');
      Promise.all([
        invoke<EvmKpis>('get_evm_kpis', { payload: { planVersionId, date: today } }),
        invoke<SCurveDataPoint[]>('get_s_curve_data', { planVersionId }),
      ])
        .then(([kpisData, sCurveData]) => {
          setKpis(kpisData);
          setSCurveData(sCurveData);
        })
        .catch((e) => {
          console.error('Failed to fetch dashboard data:', e);
          setError('Could not load dashboard data.');
        })
        .finally(() => {
          setLoading(false);
        });
    } else {
        setLoading(false);
        setKpis(null);
        setSCurveData([]);
    }
  }, [planVersionId]);

  if (loading) {
    return <Center style={{ height: '100%' }}><Loader /></Center>;
  }
  if (error) {
    return <Alert color="red" title="Error" icon={<IconAlertCircle />}>{error}</Alert>;
  }
  if (!planVersionId || !kpis) {
    return <Text c="dimmed" ta="center" pt="xl">Please select a project to view the dashboard.</Text>;
  }

  const kpiCards = [
    { title: 'Cost Perf. Index (CPI)', value: kpis.cpi.toFixed(2), color: kpis.cpi >= 1 ? 'teal' : 'red' },
    { title: 'Schedule Perf. Index (SPI)', value: kpis.spi.toFixed(2), color: kpis.spi >= 1 ? 'teal' : 'red' },
    { title: 'Cost Variance (CV)', value: (kpis.ev - kpis.ac).toLocaleString(), color: (kpis.ev - kpis.ac) >= 0 ? 'teal' : 'red' },
    { title: 'Schedule Variance (SV)', value: (kpis.ev - kpis.pv).toLocaleString(), color: (kpis.ev - kpis.pv) >= 0 ? 'teal' : 'red' },
  ];

  return (
    <Stack>
        <Title order={2}>EVM Dashboard</Title>
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
            {kpiCards.map(stat => (
                <Paper withBorder p="md" radius="md" key={stat.title}>
                    <Group justify='space-between'>
                        <Text size="xs" c="dimmed" fw={700} tt="uppercase">{stat.title}</Text>
                        <Badge color={stat.color} variant='light' />
                    </Group>
                    <Text fw={700} size="xl">{stat.value}</Text>
                </Paper>
            ))}
        </SimpleGrid>
        <Paper withBorder p="md" radius="md" mt="md" style={{height: 400}}>
            <ResponsiveContainer width="100%" height="100%">
            <LineChart data={sCurveData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="cumulativePv" name="PV (Plan)" stroke="#8884d8" />
                <Line type="monotone" dataKey="cumulativeAc" name="AC (Actual)" stroke="#ca4f4f" />
                <Line type="monotone" dataKey="cumulativeEv" name="EV (Earned)" stroke="#82ca9d" />
            </LineChart>
            </ResponsiveContainer>
      </Paper>
    </Stack>
  );
}
