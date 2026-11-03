import { Card, CardContent } from '@/components/ui/card';
import { AlertCircle } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="monitor-grid flex min-h-screen w-full items-center justify-center bg-[#111321] px-4">
      <Card className="panel w-full max-w-md border-white/10 bg-[#191b2b] text-slate-100">
        <CardContent className="pt-6">
          <div className="flex mb-4 gap-2">
            <AlertCircle className="h-8 w-8 text-rose-300" />
            <h1 className="text-2xl font-bold text-slate-100">
              Сторінку не знайдено
            </h1>
          </div>

          <p className="mt-4 text-sm text-slate-400">
            Можливо, адресу введено неправильно або сторінку переміщено.
          </p>
          <a href="/" className="mt-6 inline-flex rounded-lg bg-violet-400 px-4 py-2 text-sm font-semibold text-[#161322] hover:bg-violet-300">Повернутися до огляду</a>
        </CardContent>
      </Card>
    </div>
  );
}
