import { saveEmployee } from "./db.js";

async function seedEmployees() {
  const drivers = [
    { employeeNumber:"924", displayName:"A GREEN", email:"adamg8203@gmail.com", phoneNumber:"0448869720" },
    { employeeNumber:"938", displayName:"AT VU", email:"anhvuvuvu@yahoo.com", phoneNumber:"0449856557" },
    { employeeNumber:"486", displayName:"B REYNOLDS", email:"reynoldsbd@yahoo.com.au", phoneNumber:"0490773636" },
    { employeeNumber:"292", displayName:"C KNOECHEL", email:"carlknoechel@gmail.com", phoneNumber:"0435799784" },
    { employeeNumber:"762", displayName:"CT PHAM", email:"cong.tpham3101@gmail.com", phoneNumber:"0402630397" },
    { employeeNumber:"769", displayName:"DH HO", email:"duonghoangho1412@gmail.com", phoneNumber:"0452388929" },
    { employeeNumber:"942", displayName:"ELHAMY ZAHER", email:"harry.zaher@gmail.com", phoneNumber:"0412390855" },
    { employeeNumber:"948", displayName:"GUANYU OU", email:"garryau123@gmail.com", phoneNumber:"0424826138" },
    { employeeNumber:"895", displayName:"H XU", email:"jamesxuhong@gmail.com", phoneNumber:"0410638088" },
    { employeeNumber:"934", displayName:"I LAULU", email:"iosefalaulu6@gmail.com", phoneNumber:"0450566614" },
    { employeeNumber:"406", displayName:"J LI", email:"lj8507119@gmail.com", phoneNumber:"0406426788" },
    { employeeNumber:"943", displayName:"J SUN", email:"jasonsun_job@hotmail.com", phoneNumber:"0413852526" },
    { employeeNumber:"829", displayName:"J YOUNG", email:"jimbothemechanic@gmail.com", phoneNumber:"0434365329" },
    { employeeNumber:"959", displayName:"K SOTHISWARAN", email:"sothi2424@gmail.com", phoneNumber:"0469298780" },
    { employeeNumber:"820", displayName:"M MURPHY", email:"murphies27@gmail.com", phoneNumber:"0410576321" },
    { employeeNumber:"953", displayName:"N DWIGHT", email:"nellyanmoder@gmail.com", phoneNumber:"0413951660" },
    { employeeNumber:"899", displayName:"P DUONG", email:"namphong1966@gmail.com", phoneNumber:"0451789177" },
    { employeeNumber:"962", displayName:"S CHEN", email:"smch2006@hotmail.com", phoneNumber:"0478846613" },
    { employeeNumber:"946", displayName:"S GEARY", email:"stangeary29@gmail.com", phoneNumber:"0413819084" },
    { employeeNumber:"3054", displayName:"S PHAM", email:"sonny@punchbowlbus.com.au", phoneNumber:"0407277535" },
    { employeeNumber:"393", displayName:"SV NGUYEN", email:"sangnguyen2564@gmail.com", phoneNumber:"0412268000" },
    { employeeNumber:"945", displayName:"T DODD", email:"tiffaniedodd@gmail.com", phoneNumber:"0421390611" },
    { employeeNumber:"653", displayName:"TC TRAN", email:"tctran705@gmail.com", phoneNumber:"0405745749" },
    { employeeNumber:"4024", displayName:"TONY PETROVSKI", email:"tony@punchbowlbus.com.au", phoneNumber:"0481585311" },
    { employeeNumber:"903", displayName:"VS HA", email:"vansyha1960@gmail.com", phoneNumber:"0405141658" },
    { employeeNumber:"863", displayName:"VT NGUYEN", email:"timnguyenqjh@gmail.com", phoneNumber:"0433354808" },
    { employeeNumber:"947", displayName:"WF ZHAN", email:"darrenwfzhan@gmail.com", phoneNumber:"0431690638" },
    { employeeNumber:"957", displayName:"XD NGUYEN", email:"nguyenduy3290@gmail.com", phoneNumber:"0449663290" },
    { employeeNumber:"961", displayName:"Y DING", email:"dinglavender8866@gmail.com", phoneNumber:"0456453357" },
    { employeeNumber:"956", displayName:"Y WANG", email:"raymond3128@hotmail.com", phoneNumber:"0438863128" },
    { employeeNumber:"857", displayName:"ZG HUANG", email:"da8harry@gmail.com", phoneNumber:"0431995522" },
    { employeeNumber:"965", displayName:"F YANG", email:"thelonelyfly@gmail.com", phoneNumber:"0435853209" },
    { employeeNumber:"969", displayName:"ZW HAN", email:"johnhan0212@gmail.com", phoneNumber:"0412099288" },
    { employeeNumber:"971", displayName:"P LEDUA", email:"pc2557ledua@gmail.com", phoneNumber:"0452455945" },
    { employeeNumber:"972", displayName:"C ANDREWS", email:"con.andrews@yahoo.com", phoneNumber:"0424386606" },
    { employeeNumber:"975", displayName:"D JAMARILLO", email:"djamarillo8472@gmail.com", phoneNumber:"0421188851" },
    { employeeNumber:"974", displayName:"L TAEI", email:"luterutaei897@gmail.com", phoneNumber:"0456000746" }
  ];

 for (const d of drivers) {
    await saveEmployee({
      employeeNumber: d.employeeNumber,
      displayName: d.displayName,
      firstName: "",
      lastName: "",
      email: d.email,
      phoneNumber: d.phoneNumber,
      department: "Operations",
      role: "Driver",
      employmentType: "Casual",
      accessLevel: "Driver",
      status: "Active"
    });
    console.log("Added:", d.displayName);
  }

  alert("All drivers imported successfully.");
}

window.runEmployeeSeed = async function () {
  const ok = confirm("Import all drivers into Employees now?");
  if (!ok) return;
  await seedEmployees();
};