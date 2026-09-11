import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { MarketingShell } from "./MarketingShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function WorkspaceEntry() {
  const [workspace, setWorkspace] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    const url = new URL(window.location.href);
    const baseHost =
      (import.meta.env.VITE_PUBLIC_APP_HOST as string | undefined) ||
      window.location.hostname.replace(/^www\./, "");
    url.hostname = `${workspace}.${baseHost}`;
    url.pathname = "/login/legacy";
    url.search = "";
    url.hash = "";
    window.location.assign(url.href);
  }
  return (
    <MarketingShell>
      <main id='main-content' className='resume-main content-width'>
        <section className='checkout-panel'>
          <h1>Selamat datang kembali.</h1>
          <p className='checkout-description'>Buka workspace koperasi Anda untuk masuk ke dashboard.</p>
          <form onSubmit={submit} className='resume-form'>
            <div className='field'>
              <Label htmlFor='workspace'>Alamat workspace</Label>
              <Input
                id='workspace'
                required
                value={workspace}
                onChange={(e) => setWorkspace(e.target.value.toLowerCase())}
                pattern='[a-z0-9]([a-z0-9-]*[a-z0-9])?'
                maxLength={63}
                placeholder='sejahtera-bersama'
                autoCapitalize='none'
              />
            </div>
            <Button size='lg'>
              Buka workspace <ArrowUpRight />
            </Button>
            <p className='form-note'>
              Belum menyelesaikan pembayaran? <Link to='/checkout/resume'>Lanjutkan pendaftaran</Link>
            </p>
          </form>
        </section>
      </main>
    </MarketingShell>
  );
}
